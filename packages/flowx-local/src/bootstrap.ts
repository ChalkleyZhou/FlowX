import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getUpdateContext, readUpdateState, selectPackageDir, writeJsonAtomic, type UpdateContext } from './update-store.js';

type CliModule = { main: (argv: string[]) => Promise<void> };
export const RESTART_FOR_UPDATE = 75;

export async function loadCli(context: UpdateContext): Promise<CliModule & { packageDir: string }> {
  const packageDir = selectPackageDir(context);
  try {
    const cli: CliModule = await import(pathToFileURL(join(packageDir, 'dist', 'cli.js')).href);
    if (typeof cli.main !== 'function') throw new Error('Invalid CLI module');
    return { ...cli, packageDir };
  } catch (error) {
    if (packageDir === context.packageDir) throw error;
    rmSync(join(context.storeDir, 'active.json'), { force: true });
    writeJsonAtomic(join(context.storeDir, 'state.json'), {
      ...readUpdateState(context), result: 'failed', failure: 'verify',
    });
    const cli: CliModule = await import(pathToFileURL(join(context.packageDir, 'dist', 'cli.js')).href);
    return { ...cli, packageDir: context.packageDir };
  }
}

export async function superviseServe(context: UpdateContext, argv: string[]): Promise<number> {
  let stopping = false;
  let child: ReturnType<typeof spawn> | undefined;
  const forward = (signal: NodeJS.Signals) => { stopping = true; child?.kill(signal); };
  const onInt = () => forward('SIGINT');
  const onTerm = () => forward('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    while (true) {
      const code = await new Promise<number>((resolve, reject) => {
        child = spawn(process.execPath, [join(context.packageDir, 'dist', 'index.js'), ...argv], {
          stdio: 'inherit', windowsHide: true,
          env: { ...process.env, FLOWX_LOCAL_SERVE_CHILD: String(process.pid), FLOWX_LOCAL_ORIGINAL_PACKAGE: context.packageDir },
        });
        child.once('error', reject);
        child.once('close', (status, signal) => resolve(status ?? (signal === 'SIGINT' ? 130 : 143)));
      });
      if (stopping || code !== RESTART_FOR_UPDATE) return code;
    }
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
}

export async function bootstrap(argv: string[]): Promise<void> {
  const context = getUpdateContext();
  process.env.FLOWX_LOCAL_ORIGINAL_PACKAGE = context.packageDir;
  const command = argv[0] ?? 'serve';
  if (command === 'serve' && process.env.FLOWX_LOCAL_SERVE_CHILD !== String(process.ppid)) {
    process.exitCode = await superviseServe(context, argv);
    return;
  }
  // 校验和 worker 必须加载指定包，不读取活动指针，否则会校验到旧版本。
  const cli = process.env.FLOWX_LOCAL_BYPASS_UPDATE === '1'
    ? { ...await import('./cli.js') as CliModule, packageDir: context.packageDir }
    : await loadCli(context);
  process.env.FLOWX_LOCAL_RUNNING_PACKAGE = cli.packageDir;
  await cli.main(argv);
}
