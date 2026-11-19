import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNewerVersion } from './version.js';

export const UPDATE_INTERVAL_MS = 5 * 60 * 1000;
export const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
export type UpdateState = {
  checkedAt?: number;
  latest?: string;
  result?: 'current' | 'ready' | 'failed';
  failure?: 'check' | 'install' | 'verify';
  skippedSkills?: string[];
};
export type UpdateContext = {
  homeDir: string;
  packageDir: string;
  storeDir: string;
  development: boolean;
};

export function getUpdateContext(options: { homeDir?: string; packageDir?: string } = {}): UpdateContext {
  const homeDir = options.homeDir ?? homedir();
  const fromEntry = process.argv[1] ? dirname(dirname(resolve(process.argv[1]))) : '';
  const packageDir = resolve(options.packageDir ?? process.env.FLOWX_LOCAL_ORIGINAL_PACKAGE ??
    (fromEntry && readJson(join(fromEntry, 'package.json')).name === '@flowx-ai/local'
      ? fromEntry : join(dirname(fileURLToPath(import.meta.url)), '..')));
  const key = createHash('sha256').update(packageDir).digest('hex').slice(0, 16);
  return {
    homeDir, packageDir,
    storeDir: join(homeDir, '.flowx', 'updates', key),
    development: existsSync(join(packageDir, 'src', 'index.ts')),
  };
}

export function readJson(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

export function packageVersion(packageDir: string): string {
  const metadata = readJson(join(packageDir, 'package.json'));
  return metadata.name === '@flowx-ai/local' && typeof metadata.version === 'string'
    ? metadata.version : '0.0.0';
}

export function versionPackageDir(context: UpdateContext, version: string): string {
  if (!STABLE_VERSION.test(version)) throw new Error('Invalid stable version');
  return join(context.storeDir, 'versions', version, 'node_modules', '@flowx-ai', 'local');
}

export function selectPackageDir(context: UpdateContext): string {
  if (context.development) return context.packageDir;
  const { version } = readJson(join(context.storeDir, 'active.json'));
  if (typeof version !== 'string' || !STABLE_VERSION.test(version) ||
    !isNewerVersion(version, packageVersion(context.packageDir))) return context.packageDir;
  const candidate = versionPackageDir(context, version);
  if (packageVersion(candidate) !== version || !existsSync(join(candidate, 'dist', 'cli.js')) ||
    !existsSync(join(candidate, 'dist', 'index.js'))) return context.packageDir;
  return candidate;
}

export function readUpdateState(context: UpdateContext): UpdateState {
  const raw = readJson(join(context.storeDir, 'state.json'));
  return {
    ...(typeof raw.checkedAt === 'number' && Number.isFinite(raw.checkedAt) ? { checkedAt: raw.checkedAt } : {}),
    ...(typeof raw.latest === 'string' && STABLE_VERSION.test(raw.latest) ? { latest: raw.latest } : {}),
    ...(['current', 'ready', 'failed'].includes(String(raw.result)) ? { result: raw.result as UpdateState['result'] } : {}),
    ...(['check', 'install', 'verify'].includes(String(raw.failure)) ? { failure: raw.failure as UpdateState['failure'] } : {}),
    ...(Array.isArray(raw.skippedSkills) && raw.skippedSkills.every((path) => typeof path === 'string')
      ? { skippedSkills: raw.skippedSkills as string[] } : {}),
  };
}

export function checkDue(context: UpdateContext, now = Date.now()): boolean {
  const checkedAt = readUpdateState(context).checkedAt;
  return checkedAt === undefined || now < checkedAt || now - checkedAt >= UPDATE_INTERVAL_MS;
}

export function watchUpdateReady(context: UpdateContext, onReady: () => void): () => void {
  if (context.development) return () => {};
  try {
    mkdirSync(context.storeDir, { recursive: true });
    const watcher = watch(context.storeDir, { persistent: false }, (_event, filename) => {
      if (filename !== null && String(filename) !== 'active.json') return;
      try { onReady(); } catch { /* 文件事件不能使本地服务退出。 */ }
    });
    watcher.on('error', () => watcher.close());
    return () => watcher.close();
  } catch { return () => {}; }
}
