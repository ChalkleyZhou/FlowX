import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseSetupTargets,
  resolveSkillInstallPaths,
  SETUP_SKILL_NAMES,
  type SetupTarget,
} from './setup.js';

export type PackageInstaller = 'npm' | 'pnpm' | 'unknown';

export function pickUpdateTargets(
  homeDir = homedir(),
  targetsRaw?: string,
): SetupTarget[] {
  if (typeof targetsRaw === 'string' && targetsRaw.trim()) {
    return parseSetupTargets(targetsRaw);
  }

  const candidates: SetupTarget[] = ['cursor', 'codex', 'od'];
  const existing: SetupTarget[] = [];

  for (const target of candidates) {
    const paths = SETUP_SKILL_NAMES.flatMap((skill) =>
      resolveSkillInstallPaths(target, homeDir, skill),
    );
    if (paths.some((path) => existsSync(path))) {
      existing.push(target);
    }
  }

  // No prior setup: update all (matching setup defaults).
  return existing.length > 0 ? existing : parseSetupTargets();
}

export function detectInstallerByRoots(
  selfPackageDir: string,
  roots: { npmRoot?: string; pnpmRoot?: string },
): PackageInstaller {
  const self = selfPackageDir.replace(/\/+$/, '');
  const npmRoot = roots.npmRoot?.replace(/\/+$/, '');
  const pnpmRoot = roots.pnpmRoot?.replace(/\/+$/, '');

  if (npmRoot && self.startsWith(npmRoot)) return 'npm';
  if (pnpmRoot && self.startsWith(pnpmRoot)) return 'pnpm';
  return 'unknown';
}

export function getSelfPackageDir(moduleUrl = import.meta.url): string {
  // dist/index.js -> package root
  const selfFile = fileURLToPath(moduleUrl);
  const distDir = dirname(selfFile);
  return dirname(distDir);
}

export function detectGlobalInstaller(): PackageInstaller {
  const selfPackageDir = getSelfPackageDir();
  let npmRoot: string | undefined;
  let pnpmRoot: string | undefined;

  try {
    npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  } catch {
    // ignore
  }

  try {
    pnpmRoot = execSync('pnpm root -g', { encoding: 'utf8' }).trim();
  } catch {
    // ignore
  }

  return detectInstallerByRoots(selfPackageDir, { npmRoot, pnpmRoot });
}

