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

  it('resolves user-level skill paths (od reuses cursor)', () => {
    expect(resolveSkillInstallPaths('cursor', '/tmp/home')).toEqual([
      '/tmp/home/.cursor/skills/flowx-brainstorm-spec/SKILL.md',
    ]);
    expect(resolveSkillInstallPaths('od', '/tmp/home')).toEqual([
      '/tmp/home/.cursor/skills/flowx-brainstorm-spec/SKILL.md',
    ]);
    expect(resolveSkillInstallPaths('codex', '/tmp/home')).toEqual([
      '/tmp/home/.agents/skills/flowx-brainstorm-spec/SKILL.md',
    ]);
  });

  it('writes missing skills and skips existing ones unless force', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-setup-'));
    homes.push(home);

    const first = runSetup({ homeDir: home, targets: 'cursor,codex,od' });
    expect(first.written).toHaveLength(2);
    expect(first.skipped).toEqual([]);
    const cursorSkill = join(home, '.cursor', 'skills', 'flowx-brainstorm-spec', 'SKILL.md');
    const agentsSkill = join(home, '.agents', 'skills', 'flowx-brainstorm-spec', 'SKILL.md');
    expect(existsSync(cursorSkill)).toBe(true);
    expect(existsSync(agentsSkill)).toBe(true);
    expect(readFileSync(cursorSkill, 'utf8')).toContain('spec.md');

    writeFileSync(cursorSkill, '# custom\n', 'utf8');
    const second = runSetup({ homeDir: home, targets: 'cursor' });
    expect(second.written).toEqual([]);
    expect(second.skipped).toEqual([cursorSkill]);
    expect(readFileSync(cursorSkill, 'utf8')).toBe('# custom\n');

    const forced = runSetup({ homeDir: home, targets: 'cursor', force: true });
    expect(forced.written).toEqual([cursorSkill]);
    expect(readFileSync(cursorSkill, 'utf8')).toContain('flowx_submit_brainstorm');
  });
});
