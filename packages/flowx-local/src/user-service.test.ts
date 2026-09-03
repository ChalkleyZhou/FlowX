import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installUserService,
  isServiceInstalled,
  renderLaunchAgentPlist,
  renderSystemdUserUnit,
} from './user-service.js';

const homes: string[] = [];
afterEach(() => {
  while (homes.length) {
    rmSync(homes.pop()!, { recursive: true, force: true });
  }
});

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'flowx-svc-'));
  homes.push(home);
  return home;
}

describe('renderLaunchAgentPlist', () => {
  it('contains label, RunAtLoad, KeepAlive, node execPath, bin path and serve', () => {
    const plist = renderLaunchAgentPlist({
      nodeExecPath: '/opt/homebrew/bin/node',
      flowxBin: '/usr/local/bin/flowx-local',
      logPath: '/tmp/home/.flowx/logs/serve.log',
    });
    expect(plist).toContain('ai.flowx.local');
    expect(plist).toContain('RunAtLoad');
    expect(plist).toContain('KeepAlive');
    expect(plist).toMatch(
      /<string>\/opt\/homebrew\/bin\/node<\/string>\s*<string>\/usr\/local\/bin\/flowx-local<\/string>\s*<string>serve<\/string>/,
    );
    expect(plist).toContain('/opt/homebrew/bin:');
    expect(plist).toContain('/tmp/home/.flowx/logs/serve.log');
  });

  it('escapes XML special characters in paths', () => {
    const plist = renderLaunchAgentPlist({
      nodeExecPath: '/opt/a&b/node',
      flowxBin: '/opt/a&b/flowx-local',
      logPath: '/tmp/<log>.log',
    });
    expect(plist).toContain('/opt/a&amp;b/node');
    expect(plist).toContain('/opt/a&amp;b/flowx-local');
    expect(plist).toContain('/tmp/&lt;log&gt;.log');
    expect(plist).not.toMatch(/<string>\/opt\/a&b\//);
  });
});

describe('renderSystemdUserUnit', () => {
  it('starts node by absolute execPath then flowx-local serve', () => {
    const unit = renderSystemdUserUnit({
      nodeExecPath: '/home/u/.nvm/versions/node/v20.11.0/bin/node',
      flowxBin: '/usr/local/bin/flowx-local',
    });
    expect(unit).toContain(
      'ExecStart=/home/u/.nvm/versions/node/v20.11.0/bin/node /usr/local/bin/flowx-local serve',
    );
    expect(unit).toContain('PATH=/home/u/.nvm/versions/node/v20.11.0/bin:');
    expect(unit).toContain('Restart=always');
  });
});

describe('installUserService', () => {
  it('writes a darwin LaunchAgent plist and bootstraps after ignored bootout', async () => {
    const home = makeHome();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'launchctl' && args[0] === 'bootout') {
        throw new Error('not loaded');
      }
    });
    const uid = 502;
    const result = await installUserService({
      platform: 'darwin',
      homeDir: home,
      flowxBin: '/usr/local/bin/flowx-local',
      nodeExecPath: '/opt/homebrew/bin/node',
      run,
      uid,
    });

    const plistPath = join(home, 'Library', 'LaunchAgents', 'ai.flowx.local.plist');
    expect(result).toEqual({ plistPath });
    expect(existsSync(join(home, '.flowx', 'logs'))).toBe(true);
    const plist = readFileSync(plistPath, 'utf8');
    expect(plist).toContain('ai.flowx.local');
    expect(plist).toContain('/opt/homebrew/bin/node');
    expect(plist).toContain('/usr/local/bin/flowx-local');
    expect(plist).toContain(join(home, '.flowx', 'logs', 'serve.log'));

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]).toEqual(['launchctl', ['bootout', `gui/${uid}`, plistPath]]);
    expect(run.mock.calls[1]).toEqual(['launchctl', ['bootstrap', `gui/${uid}`, plistPath]]);
  });

  it('skips Windows without writing files', async () => {
    const home = makeHome();
    writeFileSync(join(home, 'marker'), 'keep');
    const run = vi.fn();
    const result = await installUserService({
      platform: 'win32',
      homeDir: home,
      flowxBin: 'C:\\flowx-local',
      run,
    });
    expect(result).toEqual({ skipped: 'win32' });
    expect(run).not.toHaveBeenCalled();
    expect(readdirSync(home)).toEqual(['marker']);
  });

  it('throws when launchctl bootstrap fails', async () => {
    const home = makeHome();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'launchctl' && args[0] === 'bootstrap') {
        throw new Error('bootstrap failed');
      }
    });
    await expect(
      installUserService({
        platform: 'darwin',
        homeDir: home,
        flowxBin: '/usr/local/bin/flowx-local',
        run,
        uid: 501,
      }),
    ).rejects.toThrow(/bootstrap failed/);
  });

  it('writes a linux systemd user unit and enables it', async () => {
    const home = makeHome();
    const run = vi.fn();
    const result = await installUserService({
      platform: 'linux',
      homeDir: home,
      flowxBin: '/usr/local/bin/flowx-local',
      nodeExecPath: '/usr/bin/node',
      run,
    });
    const unitPath = join(home, '.config', 'systemd', 'user', 'flowx-local.service');
    expect(result).toEqual({ unitPath });
    const unit = readFileSync(unitPath, 'utf8');
    expect(unit).toContain('ExecStart=/usr/bin/node /usr/local/bin/flowx-local serve');
    expect(unit).toContain('Restart=always');
    expect(run.mock.calls).toEqual([
      ['systemctl', ['--user', 'daemon-reload']],
      ['systemctl', ['--user', 'enable', '--now', 'flowx-local.service']],
    ]);
  });
});

describe('isServiceInstalled', () => {
  it('is true when the darwin LaunchAgent plist exists', () => {
    const home = makeHome();
    const plistPath = join(home, 'Library', 'LaunchAgents', 'ai.flowx.local.plist');
    mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(plistPath, '<plist/>');
    expect(isServiceInstalled(home, 'darwin')).toBe(true);
    expect(isServiceInstalled(home, 'linux')).toBe(false);
  });

  it('is true when the linux systemd user unit exists', () => {
    const home = makeHome();
    const unitPath = join(home, '.config', 'systemd', 'user', 'flowx-local.service');
    mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true });
    writeFileSync(unitPath, '[Service]\n');
    expect(isServiceInstalled(home, 'linux')).toBe(true);
    expect(isServiceInstalled(home, 'darwin')).toBe(false);
  });

  it('is false when no unit file exists, including win32', () => {
    const home = makeHome();
    expect(isServiceInstalled(home, 'darwin')).toBe(false);
    expect(isServiceInstalled(home, 'linux')).toBe(false);
    expect(isServiceInstalled(home, 'win32')).toBe(false);
  });
});
