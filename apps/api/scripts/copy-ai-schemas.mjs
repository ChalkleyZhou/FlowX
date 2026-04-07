import { cp, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, '..');
const sourceDir = resolve(appRoot, 'src/ai');
const targetDir = resolve(appRoot, 'dist/ai');

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, {
  force: true,
  recursive: true,
  filter: (source) => source.endsWith('.json') || !source.includes('/src/ai/'),
});
