import { existsSync, writeFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { pickUpdateTargets, detectInstallerByRoots, refreshUpdatedIntegrations } from './update.js';
import { resolveSkillInstallPaths } from './setup.js';

const refreshHomes: string[] = [];
afterEach(() => refreshHomes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })));

function ensureFile(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '# test\n', 'utf8');
}

describe('flowx-local update helpers', () => {
  it('只刷新已有原版 Skill 与 MCP，保留自定义和其他服务', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flowx-refresh-'));
    refreshHomes.push(homeDir);
    const previousPackageDir = join(homeDir, 'previous');
    const nextPackageDir = join(homeDir, 'next');
    const normal = resolveSkillInstallPaths('codex', homeDir, 'flowx-continue')[0];
    const custom = resolveSkillInstallPaths('codex', homeDir, 'flowx-product-prd')[0];
    for (const name of ['flowx-continue', 'flowx-product-prd']) {
      const previous = join(previousPackageDir, 'templates', name, 'SKILL.md');
      const next = join(nextPackageDir, 'templates', name, 'SKILL.md');
      mkdirSync(dirname(previous), { recursive: true });
      mkdirSync(dirname(next), { recursive: true });
      writeFileSync(previous, 'old');
      writeFileSync(next, 'new');
    }
    mkdirSync(dirname(normal), { recursive: true });
    mkdirSync(dirname(custom), { recursive: true });
    writeFileSync(normal, 'old');
    writeFileSync(custom, 'my custom skill');
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    writeFileSync(join(homeDir, '.codex', 'config.toml'), '[mcp_servers.flowx]\ncommand="old"\nargs=["mcp"]\n[mcp_servers.other]\ncommand="keep"\n');
    const skipped = refreshUpdatedIntegrations({ homeDir, previousPackageDir, nextPackageDir, flowxBin: '/stable/dist/index.js' });
    expect(readFileSync(normal, 'utf8')).toBe('new');
    expect(readFileSync(custom, 'utf8')).toBe('my custom skill');
    expect(skipped).toContain(custom);
    const config = readFileSync(join(homeDir, '.codex', 'config.toml'), 'utf8');
    expect(config).toContain('/stable/dist/index.js');
    expect(config).toContain('keep');
    expect(existsSync(join(homeDir, '.cursor', 'mcp.json'))).toBe(false);
    expect(existsSync(resolveSkillInstallPaths('codex', homeDir, 'flowx-local-test')[0])).toBe(false);
  });

  it('MCP 已指向稳定入口时不重写配置，避免触发 IDE 无谓重载', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flowx-refresh-'));
    refreshHomes.push(homeDir);
    const options = { homeDir, previousPackageDir: join(homeDir, 'old'), nextPackageDir: join(homeDir, 'next'), flowxBin: '/stable/dist/index.js' };
    const entries = [
      { path: join(homeDir, '.cursor', 'mcp.json'), content: JSON.stringify({ mcpServers: { flowx: { command: process.execPath, args: [options.flowxBin, 'mcp'] } } }) },
      { path: join(homeDir, '.codex', 'config.toml'), content: `# 保留注释与排版\n[mcp_servers.flowx]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ["/stable/dist/index.js", "mcp"]\n` },
    ];
    for (const entry of entries) {
      mkdirSync(dirname(entry.path), { recursive: true });
      writeFileSync(entry.path, entry.content);
      utimesSync(entry.path, 1000000, 1000000);
    }
    refreshUpdatedIntegrations(options);
    for (const entry of entries) {
      expect(readFileSync(entry.path, 'utf8')).toBe(entry.content);
      expect(statSync(entry.path).mtimeMs).toBe(1000000000);
    }
  });

  it('auto-picks only existing cursor target when only cursor is set up', () => {
    const homeDir = join(tmpdir(), `flowx-update-${Date.now()}`);
    const cursorSkill = resolveSkillInstallPaths('cursor', homeDir)[0];
    ensureFile(cursorSkill);

    const picked = pickUpdateTargets(homeDir);
    expect(picked).toEqual(['cursor']);
  });

  it('auto-picks all default targets when none exist', () => {
    const homeDir = join(tmpdir(), `flowx-update-${Date.now()}`);
    const picked = pickUpdateTargets(homeDir);
    expect(picked).toEqual(['cursor', 'codex', 'od', 'workbuddy']);
  });

  it('respects explicit targetsRaw even if other skills exist', () => {
    const homeDir = join(tmpdir(), `flowx-update-${Date.now()}`);
    const codexSkill = resolveSkillInstallPaths('codex', homeDir)[0];
    ensureFile(codexSkill);

    const picked = pickUpdateTargets(homeDir, 'cursor');
    expect(picked).toEqual(['cursor']);
  });

  it('detectInstallerByRoots detects npm vs pnpm by prefix', () => {
    const npmRoot = '/usr/local/lib/node_modules';
    const pnpmRoot = '/Users/me/.pnpm-global/node_modules';
    expect(
      detectInstallerByRoots(`${npmRoot}/@flowx-ai/local`, { npmRoot, pnpmRoot }),
    ).toBe('npm');

    expect(
      detectInstallerByRoots(`${pnpmRoot}/@flowx-ai/local`, { npmRoot, pnpmRoot }),
    ).toBe('pnpm');

    expect(
      detectInstallerByRoots('/unknown/location/@flowx-ai/local', { npmRoot, pnpmRoot }),
    ).toBe('unknown');
  });
});

