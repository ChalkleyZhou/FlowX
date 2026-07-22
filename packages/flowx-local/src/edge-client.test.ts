import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeClient } from './edge-client.js';
import { Outbox } from './outbox.js';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('EdgeClient', () => {
  it('keeps the browser-supplied public API base after redeeming a ticket', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flowx-edge-client-'));
    homes.push(homeDir);
    const send = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: 'opendesign',
          apiBaseUrl: 'http://127.0.0.1:3000',
          accessToken: 'short-token',
          accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
          handoff: { executionSessionId: 'session-1' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new EdgeClient(new Outbox({ homeDir }), send as never);

    const redeemed = await client.redeemOpenDesignLaunch(
      'https://flowx.example/api/',
      'ticket-1',
    );

    expect(send).toHaveBeenCalledWith(
      'https://flowx.example/api/edge/design-launch/redeem',
      expect.any(Object),
    );
    expect(redeemed.apiBaseUrl).toBe('https://flowx.example/api');
  });

  it('queues an offline completion without persisting the access token', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flowx-edge-client-'));
    homes.push(homeDir);
    const outbox = new Outbox({ homeDir });
    const client = new EdgeClient(outbox, vi.fn().mockRejectedValue(new Error('offline')) as never);

    await expect(
      client.submitDesign({
        apiBaseUrl: 'http://127.0.0.1:3000',
        accessToken: 'secret-short-token',
        executionSessionId: 'session-1',
        report: {
          idempotencyKey: 'design-1',
          output: {
            design: {},
            demo: {},
            designArtifact: { html: '<!doctype html><html></html>' },
          },
        },
      }),
    ).resolves.toMatchObject({ queued: true });

    const stored = readFileSync(join(outbox.root, readdirSync(outbox.root)[0]), 'utf8');
    expect(stored).not.toContain('secret-short-token');
    expect(stored).toContain('session-1');
  });
});
