import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { acquireUpdateLock } from './update-lock.js';

const homes: string[] = [];
const children: ChildProcess[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'flowx-update-lock-'));
  homes.push(dir);
  mkdirSync(join(dir, 'locks'));
  return dir;
}
afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('close', () => resolve());
    child.kill('SIGKILL');
  })));
  homes.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

it('存活 worker 尚在选号时，不能抢占或删除其独立记录', () => {
  const dir = fixture();
  const owner = join(dir, 'locks', `${process.pid}-owner.json`);
  writeFileSync(owner, JSON.stringify({ choosing: true, ticket: 0 }));
  const release = acquireUpdateLock(dir);
  try {
    expect(release).toBeNull();
    expect(readdirSync(join(dir, 'locks'))).toEqual([`${process.pid}-owner.json`]);
  } finally { release?.(); }
});

it('忽略死 worker 记录，释放只删除本次申请的文件', () => {
  const dir = fixture();
  writeFileSync(join(dir, 'locks', '2147483647-dead.json'), JSON.stringify({ choosing: true, ticket: 0 }));
  const release = acquireUpdateLock(dir);
  expect(release).toBeTypeOf('function');
  expect(acquireUpdateLock(dir)).toBeNull();
  release?.();
  const next = acquireUpdateLock(dir);
  expect(next).toBeTypeOf('function');
  next?.();
});

it('损坏的活记录与票号溢出均保守放弃，不并发安装', () => {
  const dir = fixture();
  const owner = join(dir, 'locks', `${process.pid}-owner.json`);
  for (const record of ['{', JSON.stringify({ choosing: false, ticket: Number.MAX_SAFE_INTEGER })]) {
    writeFileSync(owner, record);
    const release = acquireUpdateLock(dir);
    try { expect(release).toBeNull(); } finally { release?.(); }
  }
});

it('真实多进程争抢时只有一个进入，存活持锁者暂停也不能被接管', async () => {
  const dir = fixture();
  const source = readFileSync(new URL('./update-lock.ts', import.meta.url), 'utf8');
  writeFileSync(join(dir, 'lock.mjs'), ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  const worker = join(dir, 'worker.mjs');
  writeFileSync(worker, `
    import { acquireUpdateLock } from './lock.mjs';
    let release;
    process.on('message', (message) => {
      if (message === 'acquire') {
        release = acquireUpdateLock(process.argv[2]);
        process.send(release ? 'entered' : 'busy');
      } else if (message === 'release') {
        release?.(); process.disconnect();
      }
    });
    process.send('ready');
  `);
  const start = async () => {
    const child = fork(worker, [dir], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], execArgv: [] });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      child.once('message', () => resolve());
      child.once('error', reject);
      child.once('exit', (code) => { if (code) reject(Error(`worker exited ${code}`)); });
    });
    return child;
  };
  const acquire = (child: ChildProcess) => new Promise<unknown>((resolve) => {
    child.once('message', resolve);
    child.send('acquire');
  });
  const workers = await Promise.all(Array.from({ length: 6 }, () => start()));
  // 先让一个 worker 持锁，然后其他进程同步争抢；它暂停期间也不能被抢占。
  expect(await acquire(workers[0])).toBe('entered');
  expect(await Promise.all(workers.slice(1).map(acquire))).toEqual(Array(5).fill('busy'));
  const stopped = new Promise<void>((resolve) => workers[0].once('close', () => resolve()));
  workers[0].send('release');
  await stopped;
  // 遗留记录及旧恢复锁都不应破坏新一轮真实进程互斥。
  writeFileSync(join(dir, 'locks', '2147483647-dead.json'), '{}');
  writeFileSync(join(dir, 'update.lock'), JSON.stringify({ pid: 2147483647 }));
  writeFileSync(join(dir, 'recovery.lock'), JSON.stringify({ pid: 2147483647 }));
  const results = await Promise.all(workers.slice(1).map(acquire));
  expect(results.filter((value) => value === 'entered').length).toBeLessThanOrEqual(1);
  if (results.every((value) => value === 'busy')) expect(await acquire(workers[1])).toBe('entered');
}, 15000);


it('双进程交错回收死锁时，不会删除对方刚建立的活锁', async () => {
  const dir = fixture();
  const moduleFile = join(dir, 'lock.mjs');
  writeFileSync(moduleFile, ts.transpileModule(readFileSync(new URL('./update-lock.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  for (const name of ['update.lock', 'recovery.lock']) {
    writeFileSync(join(dir, name), JSON.stringify({ pid: 2147483647 }));
  }
  const worker = join(dir, 'race.mjs');
  writeFileSync(worker, `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    import { acquireUpdateLock } from './lock.mjs';
    const [role, dir] = process.argv.slice(2);
    const originalOpen = fs.openSync, originalRm = fs.rmSync;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    const wait = name => {
      const limit = Date.now() + 8000;
      while (!fs.existsSync(join(dir, name))) {
        if (Date.now() > limit) throw Error('barrier timeout: ' + name);
        Atomics.wait(pause, 0, 0, 10);
      }
    };
    // 固定旧实现的故障交错：A 已读死恢复锁，B 已打开尚未初始化的新主锁。
    if (role === 'a') fs.rmSync = (path, opts) => {
      if (path === join(dir, 'recovery.lock') && !fs.existsSync(join(dir, 'a-stale-read'))) {
        fs.writeFileSync(join(dir, 'a-stale-read'), '');
        wait('b-primary-open');
      }
      return originalRm(path, opts);
    };
    if (role === 'b') fs.openSync = (path, flags, ...rest) => {
      const fd = originalOpen(path, flags, ...rest);
      if (path === join(dir, 'update.lock') && flags === 'wx') {
        fs.writeFileSync(join(dir, 'b-primary-open'), '');
        wait('a-held');
      }
      return fd;
    };
    syncBuiltinESMExports();
    const release = acquireUpdateLock(dir);
    if (release) fs.writeFileSync(join(dir, role + '-held'), '');
    fs.writeFileSync(join(dir, role + '-result'), release ? 'entered' : 'busy');
    wait('release');
    release?.();
  `);
  const start = (role: string) => {
    const child = fork(worker, [role, dir], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], execArgv: [] });
    children.push(child);
  };
  try {
    start('a');
    // 修复后没有共享恢复锁；此时 A 直接进入，仍保持到 B 完成竞争。
    await vi.waitFor(() => expect(existsSync(join(dir, 'a-stale-read')) || existsSync(join(dir, 'a-held'))).toBe(true), { timeout: 5000 });
    start('b');
    await vi.waitFor(() => {
      expect(existsSync(join(dir, 'a-result'))).toBe(true);
      expect(existsSync(join(dir, 'b-result'))).toBe(true);
    }, { timeout: 5000 });
    const results = ['a', 'b'].map((role) => readFileSync(join(dir, role + '-result'), 'utf8'));
    expect(results.filter((result) => result === 'entered')).toHaveLength(1);
  } finally { writeFileSync(join(dir, 'release'), ''); }
}, 15000);
