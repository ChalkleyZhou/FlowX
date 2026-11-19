#!/usr/bin/env node

import { bootstrap } from './bootstrap.js';

bootstrap(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`flowx-local failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
