import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { DetectedLocalDevCommand, PackageManager } from './detect-local-dev-command';

export function hasNonEmptyNodeModules(dir: string): boolean {
  const nm = join(dir, 'node_modules');
  if (!existsSync(nm)) {
    return false;
  }
  try {
    return readdirSync(nm).length > 0;
  } catch {
    return false;
  }
}

/** True if either the dev package cwd or the repo root already has dependencies. */
export function dependenciesLookInstalled(repositoryRoot: string, detected: Pick<DetectedLocalDevCommand, 'cwd'>): boolean {
  const root = repositoryRoot.trim();
  if (hasNonEmptyNodeModules(detected.cwd)) {
    return true;
  }
  if (root && detected.cwd !== root && hasNonEmptyNodeModules(root)) {
    return true;
  }
  return false;
}

/**
 * pnpm workspace: install must run from repo root. Otherwise use the package that runs dev.
 */
export function resolveDependencyInstallCwd(
  repositoryRoot: string,
  detected: Pick<DetectedLocalDevCommand, 'cwd' | 'packageManager'>,
): string {
  const root = repositoryRoot.trim();
  if (root && existsSync(join(root, 'pnpm-workspace.yaml'))) {
    return root;
  }
  if (detected.packageManager === 'pnpm' && root && existsSync(join(root, 'pnpm-lock.yaml'))) {
    return root;
  }
  return detected.cwd;
}

export function resolveInstallPackageManager(
  repositoryRoot: string,
  detected: Pick<DetectedLocalDevCommand, 'packageManager'>,
): PackageManager {
  const root = repositoryRoot.trim();
  if (root && (existsSync(join(root, 'pnpm-workspace.yaml')) || existsSync(join(root, 'pnpm-lock.yaml')))) {
    return 'pnpm';
  }
  if (root && existsSync(join(root, 'yarn.lock'))) {
    return 'yarn';
  }
  if (root && (existsSync(join(root, 'package-lock.json')) || existsSync(join(root, 'npm-shrinkwrap.json')))) {
    return 'npm';
  }
  return detected.packageManager;
}

export function installCommandForPackageManager(pm: PackageManager): { command: string; args: string[] } {
  if (pm === 'pnpm') {
    return { command: 'pnpm', args: ['install'] };
  }
  if (pm === 'yarn') {
    return { command: 'yarn', args: ['install'] };
  }
  return { command: 'npm', args: ['install'] };
}

export function suggestFromDevLogTail(logTail: string): string {
  const t = logTail.toLowerCase();
  if (
    t.includes('cannot find module') ||
    t.includes('module not found') ||
    t.includes('err_module_not_found') ||
    t.includes('sh: vite: command not found') ||
    (t.includes('command not found') && t.includes('vite'))
  ) {
    return ' 常见原因：尚未安装依赖（未执行 pnpm install / npm install），或 PATH 中找不到本地 bin。';
  }
  if (t.includes('enoent') && t.includes('spawn')) {
    return ' 常见原因：找不到可执行文件（包管理器或脚本未安装）。';
  }
  return '';
}
