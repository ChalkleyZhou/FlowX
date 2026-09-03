#!/usr/bin/env node

import { startServer } from './server.js';
import { loadConfig, normalizeRepoUrl, saveConfig } from './config.js';
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
import { detectGlobalInstaller, pickUpdateTargets } from './update.js';
import { execSync, spawnSync } from 'node:child_process';

async function runLogout(): Promise<void> {
  const path = getCredentialsPath();
  await clearCredentials();
  console.log(`Removed local credentials at ${path}`);
  console.log('Tip: revoke the token in FlowX Web settings if it should no longer be valid.');
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? 'serve';
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
    const installer = detectGlobalInstaller();

    console.log(
      `Detected global installer: ${installer}. Updating @flowx-ai/local package...`,
    );

    // Ensure the newly installed package's templates are used by re-running `setup` in a fresh process.
    try {
      if (installer === 'pnpm') {
        execSync('pnpm add -g @flowx-ai/local@latest', { stdio: 'inherit' });
      } else {
        if (installer === 'unknown') {
          console.warn('Could not determine npm vs pnpm global install. Falling back to npm.');
        }
        execSync('npm install -g @flowx-ai/local@latest', { stdio: 'inherit' });
      }
    } catch (error) {
      // Still attempt skill update (best-effort) even if package update fails.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Package update failed: ${message}`);
    }

    // 升级后刷新 MCP command 与后台服务路径，不要默认带 --no-ide
    const setupArgs: string[] = ['setup', pickedTargets.join(',')];
    if (force) setupArgs.push('--force');

    const result = spawnSync('flowx-local', setupArgs, { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error('flowx-local setup failed after package update.');
    }
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
      'Usage: flowx-local [serve] | version | login [--api-base-url URL] [--token TOKEN] | logout | setup [cursor|codex|od,...] [--force] [--no-ide] [--api-base-url URL] | update [cursor|codex|od,...] [--no-force] | mcp | map <repoUrl> <path> | status | sync | design-submit <executionSessionId>',
    );
    process.exitCode = 1;
    return;
  }

  const { url } = await startServer();
  console.log(`flowx-local listening on ${url}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`flowx-local failed: ${message}`);
  process.exitCode = 1;
});
