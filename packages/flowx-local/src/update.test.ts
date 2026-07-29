import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { pickUpdateTargets, detectInstallerByRoots } from './update.js';
import { resolveSkillInstallPaths } from './setup.js';

function ensureFile(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '# test\n', 'utf8');
}

describe('flowx-local update helpers', () => {
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
    expect(picked).toEqual(['cursor', 'codex', 'od']);
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

