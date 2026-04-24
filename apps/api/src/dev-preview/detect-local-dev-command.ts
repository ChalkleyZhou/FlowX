import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

const SCRIPT_PRIORITY = ['dev', 'develop', 'start:dev', 'vite', 'serve', 'start'];

export interface DetectedLocalDevCommand {
  cwd: string;
  packageManager: PackageManager;
  scriptName: string;
  /** Example: `pnpm run dev -- --port 5174` */
  shellCommand: string;
}

function readPackageJson(dir: string): { scripts?: Record<string, string> } | null {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}

function pickDevScript(scripts: Record<string, string> | undefined): string | null {
  if (!scripts) {
    return null;
  }
  for (const name of SCRIPT_PRIORITY) {
    const value = scripts[name];
    if (typeof value === 'string' && value.trim()) {
      return name;
    }
  }
  return null;
}

export function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, 'pnpm-lock.yaml')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(dir, 'yarn.lock'))) {
    return 'yarn';
  }
  if (existsSync(join(dir, 'package-lock.json')) || existsSync(join(dir, 'npm-shrinkwrap.json'))) {
    return 'npm';
  }
  return 'npm';
}

export function resolveSpawnArgs(
  packageManager: PackageManager,
  scriptName: string,
  forwarded: string[],
): { command: string; args: string[] } {
  const extra = forwarded.length > 0 ? (['--', ...forwarded] as string[]) : [];
  if (packageManager === 'pnpm') {
    return { command: 'pnpm', args: ['run', scriptName, ...extra] };
  }
  if (packageManager === 'yarn') {
    return { command: 'yarn', args: ['run', scriptName, ...extra] };
  }
  return { command: 'npm', args: ['run', scriptName, ...extra] };
}

export function formatShellCommand(
  packageManager: PackageManager,
  scriptName: string,
  forwarded: string[],
): string {
  const { command, args } = resolveSpawnArgs(packageManager, scriptName, forwarded);
  return [command, ...args].map((part) => (/\s/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part)).join(' ');
}

function tryDetectInDirectory(dir: string): DetectedLocalDevCommand | null {
  const pkg = readPackageJson(dir);
  if (!pkg) {
    return null;
  }
  const scriptName = pickDevScript(pkg.scripts);
  if (!scriptName) {
    return null;
  }
  const packageManager = detectPackageManager(dir);
  return {
    cwd: dir,
    packageManager,
    scriptName,
    shellCommand: formatShellCommand(packageManager, scriptName, []),
  };
}

/**
 * Resolve a dev server entry directory and package manager for a repository root.
 * Tries the repository root first, then shallow `apps/*` and `packages/*` children (common monorepos).
 */
export function detectLocalDevCommand(repositoryRoot: string): DetectedLocalDevCommand | null {
  const root = repositoryRoot.trim();
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
    return null;
  }

  const direct = tryDetectInDirectory(root);
  if (direct) {
    return direct;
  }

  for (const bucket of ['apps', 'packages']) {
    const bucketPath = join(root, bucket);
    if (!existsSync(bucketPath) || !statSync(bucketPath).isDirectory()) {
      continue;
    }
    const entries = readdirSync(bucketPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const hit = tryDetectInDirectory(join(bucketPath, entry.name));
      if (hit) {
        return hit;
      }
    }
  }

  return null;
}
