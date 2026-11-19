import { startServer } from './server.js';
import { loadConfig, normalizeRepoUrl, PACKAGE_VERSION, saveConfig } from './config.js';
import {
  clearCredentials,
  getCredentialsPath,
} from './credentials.js';
import { runLogin } from './login.js';
import { submitOpenDesignResult, syncOpenDesignOutbox } from './open-design.js';
import { runLocalMcp } from './mcp.js';
import { runSetup } from './setup.js';
import { parseSetupArgs } from './setup-cli.js';
import { buildStatusPayload } from './status.js';
import { checkPackageVersion, formatVersionCheck } from './version.js';
import { pickUpdateTargets } from './update.js';
import { performUpdate, triggerAutoUpdate, runUpdateCommand } from './auto-update.js';
import { getUpdateContext, packageVersion, readUpdateState, selectPackageDir, watchUpdateReady } from './update-store.js';
import { RESTART_FOR_UPDATE } from './bootstrap.js';
import { join } from 'node:path';

async function runLogout(): Promise<void> {
  const path = getCredentialsPath();
  await clearCredentials();
  console.log(`Removed local credentials at ${path}`);
  console.log('Tip: revoke the token in FlowX Web settings if it should no longer be valid.');
}

export async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? 'serve';
  const supervisedServe = process.env.FLOWX_LOCAL_SERVE_CHILD === String(process.ppid);
  const runningPackage = process.env.FLOWX_LOCAL_RUNNING_PACKAGE;
  // 启动 IDE/终端时不能把 supervisor 子进程标记继续传播。
  delete process.env.FLOWX_LOCAL_SERVE_CHILD;
  delete process.env.FLOWX_LOCAL_RUNNING_PACKAGE;
  if (command === '__verify-update') {
    console.log(JSON.stringify({ version: PACKAGE_VERSION }));
    return;
  }
  if (command === '__auto-update') {
    await performUpdate();
    return;
  }
  if (command !== 'update' && command !== 'setup') triggerAutoUpdate();
  if (command === 'version' || command === '-v' || command === '--version') {
    try {
      const result = await checkPackageVersion();
      console.log(formatVersionCheck(result));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'login') {
    try {
      await runLogin(argv.slice(1));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'logout') {
    try {
      await runLogout();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'setup') {
    const args = argv.slice(1);
    const { targets, force, noIde, apiBaseUrl } = parseSetupArgs(args);
    try {
      const result = await runSetup({ targets, force, noIde, apiBaseUrl });
      for (const path of result.written) {
        console.log(`Wrote ${path}`);
      }
      for (const path of result.skipped) {
        console.log(`Skipped existing ${path} (use --force to overwrite)`);
      }
      if (result.written.length === 0 && result.skipped.length === 0) {
        console.log('Nothing to install.');
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'update') {
    const args = argv.slice(1);
    const noForce = args.includes('--no-force');
    const force = !noForce;
    const targetsRaw = args.find((arg) => !arg.startsWith('--'));

    const pickedTargets = pickUpdateTargets(undefined, targetsRaw);
    const context = getUpdateContext();
    const outcome = await performUpdate({ context, force: true });
    const state = readUpdateState(context);
    if (outcome === 'busy') throw new Error('已有更新正在进行，请稍后执行 flowx-local status。');
    if (outcome === 'disabled') throw new Error('源码开发目录不执行自动安装，请使用项目构建命令。');
    if (state.result === 'failed') throw new Error(`更新失败（${state.failure}），已保留可用版本。`);
    const selected = selectPackageDir(context);
    console.log(`可用版本：${packageVersion(selected)}`);
    const setupArgs = ['setup', pickedTargets.join(',')];
    if (force) setupArgs.push('--force');
    await runUpdateCommand(process.execPath, [join(selected, 'dist', 'index.js'), ...setupArgs]);
    return;
  }
  if (command === 'map') {
    const [repoUrl, path] = argv.slice(1);
    if (!repoUrl || !path) {
      console.error('Usage: flowx-local map <repoUrl> <path>');
      process.exitCode = 1;
      return;
    }
    const config = loadConfig();
    saveConfig({
      ...config,
      repositories: {
        ...config.repositories,
        [normalizeRepoUrl(repoUrl)]: path,
      },
    });
    console.log(`Mapped ${normalizeRepoUrl(repoUrl)} to ${path}`);
    return;
  }
  if (command === 'status') {
    console.log(JSON.stringify(await buildStatusPayload(), null, 2));
    return;
  }
  if (command === 'sync') {
    console.log(JSON.stringify(await syncOpenDesignOutbox(), null, 2));
    return;
  }
  if (command === 'design-submit') {
    const executionSessionId = argv[1];
    if (!executionSessionId) {
      console.error('Usage: flowx-local design-submit <executionSessionId>');
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(await submitOpenDesignResult(executionSessionId), null, 2));
    return;
  }
  if (command === 'mcp') {
    await runLocalMcp();
    return;
  }
  if (command !== 'serve') {
    console.error(`Unknown command: ${command}`);
    console.error(
      'Usage: flowx-local [serve] | version | login [--api-base-url URL] [--token TOKEN] | logout | setup [cursor|codex|od|workbuddy,...] [--force] [--no-ide] [--api-base-url URL] | update [cursor|codex|od|workbuddy,...] [--no-force] | mcp | map <repoUrl> <path> | status | sync | design-submit <executionSessionId>',
    );
    process.exitCode = 1;
    return;
  }

  const context = getUpdateContext();
  let restarting = false;
  let busy = false;
  const restartIfIdle = () => {
    if (busy || restarting || !supervisedServe || context.development) return;
    const selected = selectPackageDir(context);
    if (selected === runningPackage) return;
    restarting = true;
    server.close(() => process.exit(RESTART_FOR_UPDATE));
  };
  const { server, url } = await startServer({
    onActivity: () => { busy = true; triggerAutoUpdate(); },
    onIdle: () => {
      busy = false;
      restartIfIdle();
    },
  });
  const stopWatching = watchUpdateReady(context, restartIfIdle);
  server.once('close', stopWatching);
  restartIfIdle();
  console.log(`flowx-local listening on ${url}`);
}

