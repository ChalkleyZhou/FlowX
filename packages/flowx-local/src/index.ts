#!/usr/bin/env node

import { startServer } from './server.js';
import { loadConfig, normalizeRepoUrl, saveConfig } from './config.js';
import { ensureDeviceIdentity } from './device.js';
import { Outbox } from './outbox.js';
import { submitOpenDesignResult, syncOpenDesignOutbox } from './open-design.js';
import { runLocalMcp } from './mcp.js';
import { runSetup } from './setup.js';

async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? 'serve';
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
      'Usage: flowx-local [serve] | setup [cursor|codex|od,...] [--force] | mcp | map <repoUrl> <path> | status | sync | design-submit <executionSessionId>',
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
