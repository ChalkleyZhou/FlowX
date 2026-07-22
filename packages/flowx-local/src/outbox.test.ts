import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Outbox } from './outbox.js';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('Outbox', () => {
  it('persists items atomically and survives a new instance', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flowx-outbox-'));
    homes.push(homeDir);
    const outbox = new Outbox({ homeDir });
    await outbox.enqueue({
      eventId: 'event-1',
      kind: 'design-completion',
      credentialRef: 'session-1',
      apiBaseUrl: 'http://127.0.0.1:3000',
      path: '/execution-sessions/session-1/design/complete',
      method: 'POST',
      body: { idempotencyKey: 'design-1' },
    });

    expect(readdirSync(outbox.root)).toEqual(['event-1.json']);
    await expect(new Outbox({ homeDir }).pendingCount()).resolves.toBe(1);
  });

  it('keeps failures with retry metadata and removes successful sends', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flowx-outbox-'));
    homes.push(homeDir);
    const now = new Date('2026-07-22T00:00:00.000Z');
    const outbox = new Outbox({ homeDir, now: () => now });
    await outbox.enqueue({
      eventId: 'event-1',
      kind: 'design-completion',
      credentialRef: 'session-1',
      apiBaseUrl: 'http://127.0.0.1:3000',
      path: '/complete',
      method: 'POST',
      body: {},
    });

    await expect(outbox.flush(vi.fn().mockRejectedValue(new Error('offline')))).resolves.toEqual({
      sent: 0,
      failed: 1,
      pending: 1,
    });
    expect((await outbox.list())[0]).toEqual(
      expect.objectContaining({ attempt: 1, lastError: 'offline' }),
    );

    const later = new Outbox({ homeDir, now: () => new Date('2026-07-22T00:00:03.000Z') });
    await expect(later.flush(vi.fn().mockResolvedValue(undefined))).resolves.toEqual({
      sent: 1,
      failed: 0,
      pending: 0,
    });
  });
});
