import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfigPath, loadConfig, saveConfig } from './config.js';
import { parseSetupTargets, resolveSkillInstallPaths, runSetup } from './setup.js';

const homes: string[] = [];
const originalApiBaseUrl = process.env.FLOWX_API_BASE_URL;

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'flowx-setup-'));
  homes.push(home);
  return home;
}

beforeEach(() => {
  delete process.env.FLOWX_API_BASE_URL;
});

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop();
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  }
  if (originalApiBaseUrl === undefined) {
    delete process.env.FLOWX_API_BASE_URL;
  } else {
    process.env.FLOWX_API_BASE_URL = originalApiBaseUrl;
  }
});

describe('flowx-local setup', () => {
  it('defaults targets to cursor,codex,od', () => {
    expect(parseSetupTargets()).toEqual(['cursor', 'codex', 'od']);
    expect(parseSetupTargets('')).toEqual(['cursor', 'codex', 'od']);
  });

  it('parses comma-separated targets and rejects unknown ones', () => {
    expect(parseSetupTargets('cursor,codex')).toEqual(['cursor', 'codex']);
    expect(() => parseSetupTargets('vscode')).toThrow(/Unknown setup target/);
  });

  it('resolves user-level skill paths (od is independent from cursor)', () => {
    expect(resolveSkillInstallPaths('cursor', '/tmp/home')).toEqual([
      '/tmp/home/.cursor/skills/flowx-product-prd/SKILL.md',
    ]);
    expect(resolveSkillInstallPaths('od', '/tmp/home')).toEqual([
      '/tmp/home/.agents/skills/flowx-product-prd/SKILL.md',
    ]);
    expect(resolveSkillInstallPaths('codex', '/tmp/home')).toEqual([
      '/tmp/home/.agents/skills/flowx-product-prd/SKILL.md',
    ]);
    expect(resolveSkillInstallPaths('cursor', '/tmp/home', 'flowx-intake-requirement')).toEqual([
      '/tmp/home/.cursor/skills/flowx-intake-requirement/SKILL.md',
    ]);
  });

  it('writes missing skills and skips existing ones unless force', async () => {
    const home = makeHome();
    const extras = {
      apiBaseUrl: 'https://flowx.example/api',
      flowxBin: '/bin/flowx-local',
      installService: vi.fn(),
    };

    const first = await runSetup({ homeDir: home, targets: 'cursor,codex,od', ...extras });
    // 2 skills × (cursor + agents) = 4 paths; codex/od share agents roots per skill.
    expect(first.written).toHaveLength(4);
    expect(first.skipped).toEqual([]);
    const cursorPrd = join(home, '.cursor', 'skills', 'flowx-product-prd', 'SKILL.md');
    const agentsPrd = join(home, '.agents', 'skills', 'flowx-product-prd', 'SKILL.md');
    const cursorIntake = join(home, '.cursor', 'skills', 'flowx-intake-requirement', 'SKILL.md');
    const agentsIntake = join(home, '.agents', 'skills', 'flowx-intake-requirement', 'SKILL.md');
    expect(existsSync(cursorPrd)).toBe(true);
    expect(existsSync(agentsPrd)).toBe(true);
    expect(existsSync(cursorIntake)).toBe(true);
    expect(existsSync(agentsIntake)).toBe(true);
    expect(readFileSync(cursorPrd, 'utf8')).toContain('prd.md');
    expect(readFileSync(cursorPrd, 'utf8')).toContain('头脑风暴');
    expect(readFileSync(cursorPrd, 'utf8')).not.toContain('Superpowers');
    expect(readFileSync(cursorPrd, 'utf8')).not.toContain('OpenSpec');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('flowx_start_workflow');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('userConfirmedStart');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('用当前版本');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('flowx_create_project_version');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('禁止省略');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('普通代码修改');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('意图不明确时先询问');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('不得调用任何 `flowx_*` 工具');
    expect(readFileSync(cursorIntake, 'utf8')).not.toContain('创建前不强制二次确认');

    writeFileSync(cursorPrd, '# custom\n', 'utf8');
    const second = await runSetup({ homeDir: home, targets: 'cursor', ...extras });
    expect(second.written).toEqual([]);
    expect(second.skipped).toEqual([cursorPrd, cursorIntake]);
    expect(readFileSync(cursorPrd, 'utf8')).toBe('# custom\n');

    const forced = await runSetup({ homeDir: home, targets: 'cursor', force: true, ...extras });
    expect(forced.written).toEqual([cursorPrd, cursorIntake]);
    expect(readFileSync(cursorPrd, 'utf8')).toContain('flowx_submit_brainstorm');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('flowx_create_requirement');
  });

  it('with noIde writes API config and installs service without Skill or MCP', async () => {
    const home = makeHome();
    const plistPath = join(home, 'Library/LaunchAgents/ai.flowx.local.plist');
    const installService = vi.fn().mockResolvedValue({ plistPath });

    const result = await runSetup({
      homeDir: home,
      noIde: true,
      apiBaseUrl: 'https://flowx.example/api',
      flowxBin: '/bin/flowx-local',
      installService,
    });

    expect(existsSync(join(home, '.cursor', 'skills'))).toBe(false);
    expect(existsSync(join(home, '.agents', 'skills'))).toBe(false);
    expect(existsSync(join(home, '.cursor', 'mcp.json'))).toBe(false);
    expect(loadConfig({ homeDir: home }).apiBaseUrl).toBe('https://flowx.example/api');
    expect(installService).toHaveBeenCalledWith({ homeDir: home, flowxBin: '/bin/flowx-local' });
    expect(result.written.length).toBeGreaterThan(0);
    expect(result.written).toContain(getConfigPath({ homeDir: home }));
    expect(result.written).toContain(plistPath);
  });

  it('with noIde records the Windows scheduled task XML path', async () => {
    const home = makeHome();
    const taskXmlPath = join(home, '.flowx', 'ai.flowx.local.xml');
    const installService = vi.fn().mockResolvedValue({ taskXmlPath });

    const result = await runSetup({
      homeDir: home,
      noIde: true,
      apiBaseUrl: 'https://flowx.example/api',
      flowxBin: 'C:\\npm\\flowx-local.cmd',
      installService,
    });

    expect(result.written).toContain(getConfigPath({ homeDir: home }));
    expect(result.written).toContain(taskXmlPath);
  });

  it('writes Cursor Skill and user MCP, then installs the service', async () => {
    const home = makeHome();
    const installService = vi.fn();

    await runSetup({
      homeDir: home,
      targets: 'cursor',
      apiBaseUrl: 'https://flowx.example/api',
      flowxBin: '/bin/flowx-local',
      installService,
    });

    const cursorPrd = join(home, '.cursor', 'skills', 'flowx-product-prd', 'SKILL.md');
    const cursorIntake = join(home, '.cursor', 'skills', 'flowx-intake-requirement', 'SKILL.md');
    expect(existsSync(cursorPrd) || existsSync(cursorIntake)).toBe(true);

    const mcpPath = join(home, '.cursor', 'mcp.json');
    expect(existsSync(mcpPath)).toBe(true);
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      mcpServers?: { flowx?: { command?: string; env?: Record<string, string> } };
    };
    expect(mcp.mcpServers?.flowx?.command).toBe('/bin/flowx-local');
    expect(mcp.mcpServers?.flowx?.env?.FLOWX_API_TOKEN).toBeUndefined();
    expect(JSON.stringify(mcp)).not.toContain('FLOWX_API_TOKEN');
    expect(installService).toHaveBeenCalledWith({ homeDir: home, flowxBin: '/bin/flowx-local' });
  });

  it('rejects when API URL is a placeholder and prompt returns empty', async () => {
    const home = makeHome();
    saveConfig(
      {
        port: 3920,
        repositories: {},
        defaultIde: 'cursor',
        installationId: 'i',
        deviceId: 'd',
        apiBaseUrl: 'http://127.0.0.1:3000',
        protocolVersion: '1',
        openDesignCommand: '',
      },
      { homeDir: home },
    );

    await expect(
      runSetup({
        homeDir: home,
        promptApiBaseUrl: async () => '',
        flowxBin: '/bin/flowx-local',
        installService: vi.fn(),
      }),
    ).rejects.toThrow(/apiBaseUrl/i);
  });

  it('rejects when resolveBin throws and does not write mcp.json', async () => {
    const home = makeHome();

    await expect(
      runSetup({
        homeDir: home,
        apiBaseUrl: 'https://flowx.example/api',
        resolveBin: () => {
          throw new Error('Could not resolve flowx-local executable on PATH or from CLI entry');
        },
        installService: vi.fn(),
      }),
    ).rejects.toThrow(/flowx-local/);

    expect(existsSync(join(home, '.cursor', 'mcp.json'))).toBe(false);
  });
});
