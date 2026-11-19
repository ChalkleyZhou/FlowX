import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { checkPackageVersion, isNewerVersion } from './version.js';
import { loadConfig } from './config.js';
import {
  checkDue, getUpdateContext, packageVersion, selectPackageDir,
  STABLE_VERSION, UPDATE_INTERVAL_MS, versionPackageDir, writeJsonAtomic,
  type UpdateContext, type UpdateState,
} from './update-store.js';
import { refreshUpdatedIntegrations } from './update.js';
import { acquireUpdateLock } from './update-lock.js';

const REGISTRY = 'https://registry.npmjs.org';
const attempted = new Map<string, number>();

export function autoUpdateEnabled(homeDir?: string): boolean {
  try {
    return process.env.FLOWX_LOCAL_AUTO_UPDATE !== '0' && loadConfig({ homeDir }).autoUpdate;
  } catch { return false; }
}

export async function runUpdateCommand(command: string, args: string[], options: {
  timeoutMs?: number; capture?: boolean;
} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', options.capture ? 'pipe' : 'inherit', 'inherit'],
      env: { ...process.env, FLOWX_LOCAL_AUTO_UPDATE: '0', FLOWX_LOCAL_BYPASS_UPDATE: '1' },
      windowsHide: true,
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8192); });
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
    }, options.timeoutMs ?? 120000);
    child.once('error', (error) => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (code === 0 && !timedOut) resolve(output); else reject(new Error(timedOut ? 'Update command timed out' : `Update command failed (${code})`));
    });
  });
}

export function findNpmCli(nodeExecPath = process.execPath): string {
  const nodeDir = dirname(nodeExecPath);
  const npmCommands = [join(nodeDir, 'npm'), ...(process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'npm'))];
  const resolvedCommands = npmCommands.flatMap((path) => {
    try {
      const resolved = realpathSync(path);
      return resolved.endsWith('npm-cli.js') ? [resolved] : [];
    } catch { return []; }
  });
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'share', 'nodejs', 'npm', 'bin', 'npm-cli.js'),
    ...resolvedCommands,
    ...(process.env.FLOWX_LOCAL_NPM ? [join(dirname(process.env.FLOWX_LOCAL_NPM), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      join(dirname(process.env.FLOWX_LOCAL_NPM), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')] : []),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('Cannot locate npm-cli.js for this Node runtime');
  return found;
}

async function installPackage(prefix: string, version: string): Promise<void> {
  await runUpdateCommand(process.execPath, [findNpmCli(), 'install', '--prefix', prefix,
    '--ignore-scripts', '--engine-strict', '--no-audit', '--no-fund', '--registry', REGISTRY,
    `--@flowx-ai:registry=${REGISTRY}`, `@flowx-ai/local@${version}`]);
}

async function verifyPackage(packageDir: string, version: string): Promise<void> {
  if (packageVersion(packageDir) !== version) throw new Error('Installed version mismatch');
  const output = await runUpdateCommand(process.execPath,
    [join(packageDir, 'dist', 'index.js'), '__verify-update'], { timeoutMs: 15000, capture: true });
  if (JSON.parse(output).version !== version) throw new Error('Runtime version mismatch');
}

export type PerformUpdateOptions = {
  context?: UpdateContext;
  force?: boolean;
  now?: () => number;
  check?: () => Promise<string>;
  install?: (prefix: string, version: string) => Promise<void>;
  verify?: (packageDir: string, version: string) => Promise<void>;
};

export async function performUpdate(options: PerformUpdateOptions = {}): Promise<'done' | 'cached' | 'busy' | 'disabled'> {
  const context = options.context ?? getUpdateContext();
  if (context.development || (!options.force && !autoUpdateEnabled(context.homeDir))) return 'disabled';
  const now = options.now ?? Date.now;
  if (!options.force && !checkDue(context, now())) return 'cached';
  const release = acquireUpdateLock(context.storeDir);
  if (!release) return 'busy';
  let stage: string | undefined;
  let phase: UpdateState['failure'] = 'check';
  const checkedAt = now();
  try {
    if (!options.force && !checkDue(context, checkedAt)) return 'cached';
    const latest = await (options.check ?? (async () => {
      const result = await checkPackageVersion({ registry: REGISTRY });
      if (!result.latest) throw new Error('Version check failed');
      return result.latest;
    }))();
    if (!STABLE_VERSION.test(latest)) throw new Error('Not a stable version');
    const current = selectPackageDir(context);
    if (!isNewerVersion(latest, packageVersion(current))) {
      writeJsonAtomic(join(context.storeDir, 'state.json'), { checkedAt, latest, result: 'current' });
      return 'done';
    }
    phase = 'install';
    stage = mkdtempSync(join(context.storeDir, 'stage-'));
    await (options.install ?? installPackage)(stage, latest);
    phase = 'verify';
    const candidate = join(stage, 'node_modules', '@flowx-ai', 'local');
    await (options.verify ?? verifyPackage)(candidate, latest);
    const destination = dirname(dirname(dirname(versionPackageDir(context, latest))));
    mkdirSync(dirname(destination), { recursive: true });
    // 未发布的同版本目录只可能来自上次安装中断；先验证，绝不覆盖已加载的文件。
    if (existsSync(destination)) await (options.verify ?? verifyPackage)(versionPackageDir(context, latest), latest);
    else renameSync(stage, destination);
    writeJsonAtomic(join(context.storeDir, 'active.json'), { version: latest });
    const skippedSkills = refreshUpdatedIntegrations({
      homeDir: context.homeDir, previousPackageDir: current,
      nextPackageDir: versionPackageDir(context, latest), flowxBin: join(context.packageDir, 'dist', 'index.js'),
    });
    writeJsonAtomic(join(context.storeDir, 'state.json'), { checkedAt, latest, result: 'ready',
      ...(skippedSkills.length ? { skippedSkills } : {}) });
    return 'done';
  } catch {
    writeJsonAtomic(join(context.storeDir, 'state.json'), { checkedAt, result: 'failed', failure: phase });
    return 'done';
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    release();
  }
}

export function triggerAutoUpdate(options: {
  context?: UpdateContext; enabled?: boolean; launch?: () => void;
} = {}): void {
  try {
    const context = options.context ?? getUpdateContext();
    if (context.development || !(options.enabled ?? autoUpdateEnabled(context.homeDir)) || !checkDue(context)) return;
    const now = Date.now();
    const last = attempted.get(context.storeDir);
    if (last !== undefined && now >= last && now - last < UPDATE_INTERVAL_MS) return;
    attempted.set(context.storeDir, now);
    if (options.launch) { options.launch(); return; }
    mkdirSync(context.storeDir, { recursive: true });
    const log = openSync(join(context.storeDir, 'update.log'), 'a', 0o600);
    try {
      const child = spawn(process.execPath, [join(selectPackageDir(context), 'dist', 'index.js'), '__auto-update'], {
        detached: true, stdio: ['ignore', log, log], windowsHide: true,
        env: { ...process.env, FLOWX_LOCAL_ORIGINAL_PACKAGE: context.packageDir, FLOWX_LOCAL_BYPASS_UPDATE: '1' },
      });
      child.on('error', () => {});
      child.unref();
    } finally { closeSync(log); }
  } catch { /* 自动更新不能影响本次调用，也不能污染 MCP stdout。 */ }
}
