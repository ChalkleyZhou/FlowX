import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findNpmCli, performUpdate, triggerAutoUpdate } from './auto-update.js';
import { getUpdateContext, readUpdateState, selectPackageDir, writeJsonAtomic } from './update-store.js';

const homes: string[] = [];
function fixture() {
  const homeDir = mkdtempSync(join(tmpdir(), 'flowx-auto-update-'));
  homes.push(homeDir);
  const packageDir = join(homeDir, 'original');
  createPackage(packageDir, '0.7.2');
  return getUpdateContext({ homeDir, packageDir });
}
function createPackage(root: string, version: string) {
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@flowx-ai/local', version, type: 'module' }));
  writeFileSync(join(root, 'dist', 'index.js'), '');
  writeFileSync(join(root, 'dist', 'cli.js'), 'export async function main() {}');
}
afterEach(() => { vi.restoreAllMocks(); homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })); });

describe('按活动触发自动更新', () => {
  it('从系统 Node 旁边的 npm 符号链接定位 Debian 风格 npm CLI', () => {
    const context = fixture();
    const bin = join(context.homeDir, 'usr', 'bin');
    const npmCli = join(context.homeDir, 'usr', 'share', 'nodejs', 'npm', 'bin', 'npm-cli.js');
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(npmCli, '..'), { recursive: true });
    writeFileSync(npmCli, '');
    symlinkSync(npmCli, join(bin, 'npm'));
    expect(findNpmCli(join(bin, 'node'))).toBe(npmCli);
  });

  it('准备独立版本并验证成功后才切换，五分钟内不重复检查', async () => {
    const context = fixture();
    const check = vi.fn(async () => '0.8.0');
    const install = vi.fn(async (prefix: string, version: string) => {
      expect(selectPackageDir(context)).toBe(context.packageDir);
      createPackage(join(prefix, 'node_modules', '@flowx-ai', 'local'), version);
    });
    const verify = vi.fn(async () => {});
    await performUpdate({ context, now: () => 1000000, check, install, verify });
    expect(selectPackageDir(context)).toContain('versions/0.8.0/node_modules/@flowx-ai/local');
    expect(verify).toHaveBeenCalledOnce();
    await performUpdate({ context, now: () => 1000001, check, install, verify });
    expect(check).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(readUpdateState(context)).toMatchObject({ result: 'ready', latest: '0.8.0' });
  });

  it.each(['网络失败', '安装失败', '启动校验失败'])('%s 保留旧版，记录分类并限制重试', async (failure) => {
    const context = fixture();
    const check = vi.fn(async () => { if (failure === '网络失败') throw Error('secret=not-for-status'); return '0.8.0'; });
    const install = async (prefix: string) => {
      if (failure === '安装失败') throw Error('install');
      createPackage(join(prefix, 'node_modules', '@flowx-ai', 'local'), '0.8.0');
    };
    const verify = async () => { throw Error('broken entry'); };
    await performUpdate({ context, now: () => 1000000, check, install, verify });
    expect(selectPackageDir(context)).toBe(context.packageDir);
    expect(readUpdateState(context).result).toBe('failed');
    expect(JSON.stringify(readUpdateState(context))).not.toContain('secret');
    await performUpdate({ context, now: () => 1000001, check, install, verify });
    expect(check).toHaveBeenCalledOnce();
  });

  it('并发调用只安装一次，存活的持锁进程不能被抢占', async () => {
    const context = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const check = vi.fn(async () => { await pending; return '0.7.2'; });
    const first = performUpdate({ context, check });
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
    expect(await performUpdate({ context, force: true, check })).toBe('busy');
    release();
    await first;
    expect(check).toHaveBeenCalledOnce();
  });

  it('恢复已退出 worker 的遗留锁', async () => {
    const context = fixture();
    writeJsonAtomic(join(context.storeDir, 'locks', '2147483647-dead.json'), { choosing: false, ticket: 1 });
    const check = vi.fn(async () => '0.7.2');
    await performUpdate({ context, check });
    expect(check).toHaveBeenCalledOnce();
  });

  it('死 worker 在选号期间退出后，后续更新仍可继续', async () => {
    const context = fixture();
    writeJsonAtomic(join(context.storeDir, 'locks', '2147483647-dead.json'), { choosing: false, ticket: 1 });
    writeJsonAtomic(join(context.storeDir, 'locks', '2147483647-choosing.json'), { choosing: true, ticket: 0 });
    const check = vi.fn(async () => '0.7.2');
    await performUpdate({ context, check });
    expect(check).toHaveBeenCalledOnce();
  });

  it('使用真实子进程校验安装，启动失败不会切换入口', async () => {
    const context = fixture();
    await performUpdate({ context, check: async () => '0.8.0', install: async (prefix, version) => {
      const root = join(prefix, 'node_modules', '@flowx-ai', 'local');
      createPackage(root, version);
      writeFileSync(join(root, 'dist', 'index.js'), 'process.exit(1);');
    } });
    expect(readUpdateState(context)).toMatchObject({ result: 'failed', failure: 'verify' });
    expect(selectPackageDir(context)).toBe(context.packageDir);
  });

  it.each(['0.8.0-beta.1', '../../evil', '0.7.1'])('不安装预发布、非法或更低版本 %s', async (version) => {
    const context = fixture();
    const install = vi.fn();
    await performUpdate({ context, check: async () => version, install });
    expect(install).not.toHaveBeenCalled();
    expect(selectPackageDir(context)).toBe(context.packageDir);
  });

  it('关闭、开发安装和缓存有效时不启动后台进程', () => {
    const context = fixture();
    const launch = vi.fn();
    triggerAutoUpdate({ context, enabled: false, launch });
    triggerAutoUpdate({ context: { ...context, development: true }, launch });
    writeJsonAtomic(join(context.storeDir, 'state.json'), { checkedAt: Date.now(), result: 'current' });
    triggerAutoUpdate({ context, launch });
    expect(launch).not.toHaveBeenCalled();
  });

  it('触发后立即返回，多次活动在本进程内合并', () => {
    const context = fixture();
    const launch = vi.fn();
    triggerAutoUpdate({ context, launch });
    triggerAutoUpdate({ context, launch });
    expect(launch).toHaveBeenCalledOnce();
  });
});
