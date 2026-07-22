import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type OutboxItem = {
  eventId: string;
  kind: 'design-completion' | 'brainstorm-completion';
  credentialRef: string;
  apiBaseUrl: string;
  path: string;
  method: 'POST';
  body: unknown;
  attempt: number;
  nextRetryAt: string;
  lastError: string | null;
  createdAt: string;
};

export type OutboxOptions = { homeDir?: string; now?: () => Date };

export class Outbox {
  constructor(private readonly options: OutboxOptions = {}) {}

  get root() {
    return join(this.options.homeDir ?? homedir(), '.flowx', 'outbox');
  }

  async enqueue(
    input: Omit<OutboxItem, 'eventId' | 'attempt' | 'nextRetryAt' | 'lastError' | 'createdAt'> & {
      eventId?: string;
    },
  ) {
    const now = this.now();
    const item: OutboxItem = {
      ...input,
      eventId: input.eventId ?? randomUUID(),
      attempt: 0,
      nextRetryAt: now.toISOString(),
      lastError: null,
      createdAt: now.toISOString(),
    };
    await this.write(item);
    return item;
  }

  async list(): Promise<OutboxItem[]> {
    try {
      const files = (await readdir(this.root)).filter((file) => file.endsWith('.json')).sort();
      return Promise.all(
        files.map(async (file) => JSON.parse(await readFile(join(this.root, file), 'utf8')) as OutboxItem),
      );
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async pendingCount() {
    return (await this.list()).length;
  }

  async flush(send: (item: OutboxItem) => Promise<void>) {
    const now = this.now();
    const items = await this.list();
    let sent = 0;
    let failed = 0;
    for (const item of items) {
      if (new Date(item.nextRetryAt).getTime() > now.getTime()) continue;
      try {
        await send(item);
        await rm(this.path(item.eventId), { force: true });
        sent += 1;
      } catch (error) {
        const attempt = item.attempt + 1;
        const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
        await this.write({
          ...item,
          attempt,
          nextRetryAt: new Date(now.getTime() + delayMs).toISOString(),
          lastError: error instanceof Error ? error.message : String(error),
        });
        failed += 1;
      }
    }
    return { sent, failed, pending: await this.pendingCount() };
  }

  private async write(item: OutboxItem) {
    await mkdir(this.root, { recursive: true });
    const target = this.path(item.eventId);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(item, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  }

  private path(eventId: string) {
    return join(this.root, `${eventId.replace(/[^a-zA-Z0-9._-]/g, '-')}.json`);
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
