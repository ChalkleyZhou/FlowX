import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveConfig } from './config.js';
import { buildStatusPayload } from './status.js';

const homes: string[] = [];

afterEach(() => {
  while (homes.length) {
    rmSync(homes.pop()!, { recursive: true, force: true });
  }
});

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'flowx-status-'));
  homes.push(home);
  return home;
}

function seedConfig(home: string, port = 3920) {
  saveConfig(
    {
      port,
      repositories: {},
      defaultIde: 'cursor',
      installationId: 'install-1',
      deviceId: 'device-1',
      apiBaseUrl: 'https://flowx.example/api',
      protocolVersion: '1',
      openDesignCommand: '',
    },
    { homeDir: home },
  );
}

describe('buildStatusPayload', () => {
  it('reports service installed and healthOk from plist and health fetch', async () => {
    const home = makeHome();
    seedConfig(home, 4123);
    const plistPath = join(home, 'Library', 'LaunchAgents', 'ai.flowx.local.plist');
    mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(plistPath, '<plist/>');
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    const payload = await buildStatusPayload({
      homeDir: home,
      platform: 'darwin',
      fetchImpl,
    });

    expect(payload).toMatchObject({
      deviceId: 'device-1',
      installationId: 'install-1',
      protocolVersion: '1',
      apiBaseUrl: 'https://flowx.example/api',
      outboxPending: 0,
      service: { platform: 'darwin', installed: true, healthOk: true },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4123/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('reports installed false and healthOk false when the unit is missing and fetch fails', async () => {
    const home = makeHome();
    seedConfig(home);
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const payload = await buildStatusPayload({
      homeDir: home,
      platform: 'linux',
      fetchImpl,
    });

    expect(payload.service).toEqual({
      platform: 'linux',
      installed: false,
      healthOk: false,
    });
  });

  it('treats a non-ok health response as healthOk false', async () => {
    const home = makeHome();
    seedConfig(home);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });

    const payload = await buildStatusPayload({
      homeDir: home,
      platform: 'darwin',
      fetchImpl,
    });

    expect(payload.service.healthOk).toBe(false);
    expect(payload.service.installed).toBe(false);
  });
});
