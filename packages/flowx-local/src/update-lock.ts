import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Ticket = { choosing: boolean; ticket: number };

function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function readTicket(path: string): Ticket | 'gone' | 'invalid' {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid';
    const record = value as Record<string, unknown>;
    if (typeof record.choosing !== 'boolean' || !Number.isSafeInteger(record.ticket) || Number(record.ticket) < 0 ||
      (!record.choosing && record.ticket === 0)) return 'invalid';
    return { choosing: record.choosing, ticket: Number(record.ticket) };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'gone' : 'invalid';
  }
}

/**
 * 非等待式 bakery 锁：每次申请拥有唯一记录，绝不回收可被新 owner 复用的共享锁路径。
 * choosing 先于选号发布；出票后重新枚举，后来加入者必然看到本次票号并让行。
 * 活 owner 不完整或正在选号时保守放弃，退出进程的记录不参与竞争。
 */
export function acquireUpdateLock(storeDir: string): (() => void) | null {
  const directory = join(storeDir, 'locks');
  mkdirSync(directory, { recursive: true });
  const name = `${process.pid}-${randomUUID()}.json`;
  const path = join(directory, name);
  const temporary = `${path}.tmp`;
  let held = false;
  const release = () => { rmSync(path, { force: true }); };
  const publish = (ticket: Ticket) => {
    writeFileSync(temporary, JSON.stringify(ticket), { mode: 0o600 });
    renameSync(temporary, path);
  };
  const owners = () => readdirSync(directory).filter((file) => {
    if (file === name) return false;
    const match = /^(\d+)-[a-zA-Z0-9-]+\.json$/.exec(file);
    return match !== null && processAlive(Number(match[1]));
  });
  try {
    publish({ choosing: true, ticket: 0 });
    let maximum = 0;
    for (const file of owners()) {
      const other = readTicket(join(directory, file));
      if (other === 'gone') continue;
      if (other === 'invalid') return null;
      maximum = Math.max(maximum, other.ticket);
    }
    if (maximum >= Number.MAX_SAFE_INTEGER) return null;
    const ticket = maximum + 1;
    publish({ choosing: false, ticket });
    // 必须重新枚举：第一次扫描后注册的竞争者也必须参与最终比较。
    for (const file of owners()) {
      const other = readTicket(join(directory, file));
      if (other === 'gone') continue;
      if (other === 'invalid' || other.choosing || other.ticket < ticket ||
        (other.ticket === ticket && file < name)) return null;
    }
    held = true;
    return release;
  } finally {
    rmSync(temporary, { force: true });
    if (!held) release();
  }
}
