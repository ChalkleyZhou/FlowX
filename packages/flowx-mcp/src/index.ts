#!/usr/bin/env node

import { runStdioServer } from './server.js';

runStdioServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`flowx-mcp failed: ${message}`);
  process.exitCode = 1;
});
