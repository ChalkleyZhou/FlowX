import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUpdateContext, readUpdateState, selectPackageDir, watchUpdateReady, writeJsonAtomic } from './update-store.js';

const homes: string[] = [];
export function makePackage(root: string, version: string) {
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@flowx-ai/local', version, type: 'module' }));
  writeFileSync(join(root, 'dist', 'cli.js'), 'export async function main() {}');
  writeFileSync(join(root, 'dist', 'index.js'), '');
}
function fixture() {
  const homeDir = mkdtempSync(join(tmpdir(), 'flowx-update-store-'));
  homes.push(homeDir);
  const packageDir = join(homeDir, 'original');
  makePackage(packageDir, '0.7.2');
  return getUpdateContext({ homeDir, packageDir });
}
afterEach(() => homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })));

describe('不可变更新仓库', () => {
  it('保留 pnpm 全局稳定 symlink，不把持久入口固化到带版本目录', () => {
    const context = fixture();
    const stable = join(context.homeDir, 'stable');
    symlinkSync(context.packageDir, stable, 'dir');
    const linked = getUpdateContext({ homeDir: context.homeDir, packageDir: stable });
    expect(linked.packageDir).toBe(stable);
    const next = join(context.homeDir, 'next');
    makePackage(next, '0.9.0');
    rmSync(stable);
    symlinkSync(next, stable, 'dir');
    expect(getUpdateContext({ homeDir: context.homeDir, packageDir: stable }).storeDir).toBe(linked.storeDir);
    expect(selectPackageDir(linked)).toBe(stable);
  });

  it('活动指针原子发布时发出事件，空闲服务无需新请求便可切换', async () => {
    const context = fixture();
    const ready = vi.fn();
    const close = watchUpdateReady(context, ready);
    try {
      writeJsonAtomic(join(context.storeDir, 'active.json'), { version: '0.8.0' });
      await vi.waitFor(() => expect(ready).toHaveBeenCalled());
    } finally { close(); }
  });

  it('只选择完整且更高版本的安装，原包升级后不降级', () => {
    const context = fixture();
    const candidate = join(context.storeDir, 'versions', '0.8.0', 'node_modules', '@flowx-ai', 'local');
    makePackage(candidate, '0.8.0');
    writeJsonAtomic(join(context.storeDir, 'active.json'), { version: '0.8.0' });
    expect(selectPackageDir(context)).toBe(candidate);
    makePackage(context.packageDir, '0.9.0');
    expect(selectPackageDir(context)).toBe(context.packageDir);
  });

  it('损坏、不完整和带路径的活动版本回退原包', () => {
    const context = fixture();
    for (const version of ['../../outside', '0.8.0', '0.8.0-beta.1']) {
      writeJsonAtomic(join(context.storeDir, 'active.json'), { version });
      expect(selectPackageDir(context)).toBe(context.packageDir);
    }
    writeFileSync(join(context.storeDir, 'active.json'), '{');
    expect(selectPackageDir(context)).toBe(context.packageDir);
  });

  it('不同安装位置使用独立缓存，开发目录不自动更新', () => {
    const context = fixture();
    expect(getUpdateContext({ homeDir: context.homeDir, packageDir: join(context.homeDir, 'other') }).storeDir)
      .not.toBe(context.storeDir);
    mkdirSync(join(context.packageDir, 'src'));
    writeFileSync(join(context.packageDir, 'src', 'index.ts'), '');
    expect(getUpdateContext({ homeDir: context.homeDir, packageDir: context.packageDir }).development).toBe(true);
  });

  it('原子保存状态，缺失状态为空', () => {
    const context = fixture();
    expect(readUpdateState(context)).toEqual({});
    writeJsonAtomic(join(context.storeDir, 'state.json'), { checkedAt: 100, result: 'current' });
    expect(readUpdateState(context)).toEqual({ checkedAt: 100, result: 'current' });
    expect(JSON.parse(readFileSync(join(context.storeDir, 'state.json'), 'utf8'))).toHaveProperty('checkedAt', 100);
  });
});
