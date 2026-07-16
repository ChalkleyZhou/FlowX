#!/usr/bin/env node

import { startServer } from './server.js';
import { loadConfig, normalizeRepoUrl, saveConfig } from './config.js';

async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? 'serve';
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
  if (command !== 'serve') {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: flowx-local [serve] | map <repoUrl> <path>');
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
