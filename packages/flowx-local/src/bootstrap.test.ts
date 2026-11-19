import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCli, superviseServe } from './bootstrap.js';
import { getUpdateContext, writeJsonAtomic } from './update-store.js';

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })));
function fixture() {
  const homeDir = mkdtempSync(join(tmpdir(), 'flowx-bootstrap-'));
  homes.push(homeDir);
  const packageDir = join(homeDir, 'original');
  mkdirSync(join(packageDir, 'dist'), { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@flowx-ai/local', version: '0.7.2', type: 'module' }));
  writeFileSync(join(packageDir, 'dist', 'cli.js'), 'export async function main() { return "original"; }');
  return getUpdateContext({ homeDir, packageDir });
}

describe('稳定启动入口', () => {
  it('新版依赖导入失败时回退原包，并撤回失败的活动指针', async () => {
    const context = fixture();
    const candidate = join(context.storeDir, 'versions', '0.8.0', 'node_modules', '@flowx-ai', 'local');
    mkdirSync(join(candidate, 'dist'), { recursive: true });
    writeFileSync(join(candidate, 'package.json'), JSON.stringify({ name: '@flowx-ai/local', version: '0.8.0', type: 'module' }));
    writeFileSync(join(candidate, 'dist', 'index.js'), '');
    writeFileSync(join(candidate, 'dist', 'cli.js'), 'import "missing-flowx-dependency";');
    writeJsonAtomic(join(context.storeDir, 'active.json'), { version: '0.8.0' });
    const loaded = await loadCli(context);
    expect(await loaded.main([])).toBe('original');
    expect(loaded.packageDir).toBe(context.packageDir);
  });

  it('服务只在请求切换时重新启动，不把正常退出循环拉起', async () => {
    const context = fixture();
    const counter = join(context.homeDir, 'counter');
    writeFileSync(join(context.packageDir, 'dist', 'index.js'), `
      import { existsSync, readFileSync, writeFileSync } from 'node:fs';
      const file = ${JSON.stringify(counter)};
      const count = existsSync(file) ? Number(readFileSync(file, 'utf8')) + 1 : 1;
      writeFileSync(file, String(count));
      process.exit(count === 1 ? 75 : 0);
    `);
    expect(await superviseServe(context, ['serve'])).toBe(0);
    expect(readFileSync(counter, 'utf8')).toBe('2');
  });
});
