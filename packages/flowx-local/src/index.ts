#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { startServer } from './server.js';
import { DEFAULT_LOCAL_CONFIG, loadConfig, normalizeRepoUrl, saveConfig } from './config.js';
import {
  clearCredentials,
  getCredentialsPath,
  writeCredentials,
} from './credentials.js';
import { ensureDeviceIdentity } from './device.js';
import { Outbox } from './outbox.js';
import { submitOpenDesignResult, syncOpenDesignOutbox } from './open-design.js';
import { runLocalMcp } from './mcp.js';
import { runSetup } from './setup.js';
import { checkPackageVersion, formatVersionCheck } from './version.js';

function readFlagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function promptToken(): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const token = (await rl.question('Paste FlowX Personal API Token: ')).trim();
    if (!token) {
      throw new Error('Token is required.');
    }
    return token;
  } finally {
    rl.close();
  }
}

async function validateApiToken(apiBaseUrl: string, apiToken: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/auth/session/me`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Token validation failed (${response.status}): ${message || response.statusText}`,
    );
  }
}

async function runLogin(argv: string[]): Promise<void> {
  const apiBaseUrl = (
    readFlagValue(argv, '--api-base-url') ??
    process.env.FLOWX_API_BASE_URL ??
    loadConfig().apiBaseUrl ??
    DEFAULT_LOCAL_CONFIG.apiBaseUrl
  )
    .trim()
    .replace(/\/+$/, '');
  const tokenFromFlag = readFlagValue(argv, '--token');
  const apiToken = (tokenFromFlag ?? (await promptToken())).trim();
  if (!apiBaseUrl) {
    throw new Error('apiBaseUrl is required. Pass --api-base-url or configure local.json.');
  }
  if (!apiToken) {
    throw new Error('Token is required. Pass --token or paste when prompted.');
  }

  try {
    await validateApiToken(apiBaseUrl, apiToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('fetch failed') || message.includes('ECONNREFUSED')) {
      console.warn(`Warning: could not reach ${apiBaseUrl}/auth/session/me (${message}). Saving token anyway.`);
      if (/127\.0\.0\.1|localhost/.test(apiBaseUrl)) {
        console.warn(
          'Hint: login defaults to http://127.0.0.1:3000. For a deployed FlowX, re-run with --api-base-url https://your-flowx-host/api',
        );
      }
    } else {
      throw error;
    }
  }

  const path = await writeCredentials({ apiBaseUrl, apiToken });
  console.log(`Saved credentials to ${path}`);
  console.log(`apiBaseUrl=${apiBaseUrl}`);
}

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
    const force = args.includes('--force');
    const targets = args.find((arg) => arg !== '--force');
    try {
      const result = runSetup({ targets, force });
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
    const config = ensureDeviceIdentity();
    console.log(
      JSON.stringify(
        {
          deviceId: config.deviceId,
          installationId: config.installationId,
          protocolVersion: config.protocolVersion,
          apiBaseUrl: config.apiBaseUrl,
          outboxPending: await new Outbox().pendingCount(),
        },
        null,
        2,
      ),
    );
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
      'Usage: flowx-local [serve] | version | login [--api-base-url URL] [--token TOKEN] | logout | setup [cursor|codex|od,...] [--force] | mcp | map <repoUrl> <path> | status | sync | design-submit <executionSessionId>',
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
