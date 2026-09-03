import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSetupTargets, resolveSkillInstallPaths, runSetup } from './setup.js';

const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop();
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
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

  it('writes missing skills and skips existing ones unless force', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-setup-'));
    homes.push(home);

    const first = runSetup({ homeDir: home, targets: 'cursor,codex,od' });
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
    const second = runSetup({ homeDir: home, targets: 'cursor' });
    expect(second.written).toEqual([]);
    expect(second.skipped).toEqual([cursorPrd, cursorIntake]);
    expect(readFileSync(cursorPrd, 'utf8')).toBe('# custom\n');

    const forced = runSetup({ homeDir: home, targets: 'cursor', force: true });
    expect(forced.written).toEqual([cursorPrd, cursorIntake]);
    expect(readFileSync(cursorPrd, 'utf8')).toContain('flowx_submit_brainstorm');
    expect(readFileSync(cursorIntake, 'utf8')).toContain('flowx_create_requirement');
  });
});
