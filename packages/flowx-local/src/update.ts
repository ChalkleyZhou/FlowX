import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseSetupTargets,
  resolveSkillInstallPaths,
  SETUP_SKILL_NAMES,
  type SetupTarget,
} from './setup.js';
import { parse } from 'smol-toml';
import { upsertUserMcp } from './user-mcp.js';

export function refreshUpdatedIntegrations(options: {
  homeDir: string; previousPackageDir: string; nextPackageDir: string; flowxBin: string;
}): string[] {
  const skipped: string[] = [];
  for (const target of ['cursor', 'codex', 'od', 'workbuddy'] as const) {
    for (const skill of SETUP_SKILL_NAMES) {
      for (const path of resolveSkillInstallPaths(target, options.homeDir, skill)) {
        if (!existsSync(path)) continue;
        try {
          const previous = readFileSync(join(options.previousPackageDir, 'templates', skill, 'SKILL.md'), 'utf8');
          const next = readFileSync(join(options.nextPackageDir, 'templates', skill, 'SKILL.md'), 'utf8');
          const installed = readFileSync(path, 'utf8');
          if (installed === previous) writeFileSync(path, next, 'utf8');
          else if (installed !== next) skipped.push(path);
        } catch { skipped.push(path); }
      }
    }
    if (target === 'od') continue;
    const path = target === 'codex' ? join(options.homeDir, '.codex', 'config.toml')
      : join(options.homeDir, `.${target}`, 'mcp.json');
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf8');
      const document = target === 'codex' ? parse(raw) : JSON.parse(raw) as Record<string, unknown>;
      const servers = target === 'codex' ? document.mcp_servers : document.mcpServers;
      if (!servers || typeof servers !== 'object' || !('flowx' in servers)) continue;
      upsertUserMcp({ homeDir: options.homeDir, targets: [target], flowxBin: options.flowxBin, skipUnchanged: true });
    } catch { skipped.push(path); }
  }
  return skipped;
}

export type PackageInstaller = 'npm' | 'pnpm' | 'unknown';

export function pickUpdateTargets(
  homeDir = homedir(),
  targetsRaw?: string,
): SetupTarget[] {
  if (typeof targetsRaw === 'string' && targetsRaw.trim()) {
    return parseSetupTargets(targetsRaw);
  }

  const candidates: SetupTarget[] = ['cursor', 'codex', 'od', 'workbuddy'];
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

