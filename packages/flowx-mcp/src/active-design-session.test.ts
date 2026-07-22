import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readActiveDesignSession } from './active-design-session.js';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('readActiveDesignSession', () => {
  it('falls back to the newest design-sessions session.json + context workflowRunId', async () => {
    const homeDir = join(tmpdir(), `flowx-mcp-active-${Date.now()}`);
    homes.push(homeDir);
    const sessionDir = join(homeDir, '.flowx', 'design-sessions', 'session-1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'session.json'),
      JSON.stringify({
        executionSessionId: 'session-1',
        apiBaseUrl: 'http://127.0.0.1:3000',
        accessToken: 'token-1',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      }),
    );
    writeFileSync(
      join(sessionDir, 'context.json'),
      JSON.stringify({ workflowRunId: 'workflow-1' }),
    );

    await expect(readActiveDesignSession(homeDir)).resolves.toMatchObject({
      workflowRunId: 'workflow-1',
      executionSessionId: 'session-1',
      accessToken: 'token-1',
    });
  });
});
