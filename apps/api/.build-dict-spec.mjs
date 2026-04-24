import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

// Dynamic import to reuse emit-dict-json logic
const modPath = join(dirname(fileURLToPath(import.meta.url)), 'emit-dict-json.mjs');
await import(pathToFileURL(modPath).href);
