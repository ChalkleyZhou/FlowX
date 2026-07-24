import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalServer, startServer } from './server.js';
import { writeActiveDesignSession } from './active-design-session.js';

const servers: Server[] = [];
const homes: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'flowx-server-'));
  homes.push(home);
  return home;
}

describe('flowx-local server', () => {
  it('serves GET /health on loopback', async () => {
    const { server, url } = await startServer({ port: 0, homeDir: makeHome() });
    servers.push(server);

    expect(url.startsWith('http://127.0.0.1:')).toBe(true);

    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      version: '0.4.0',
      protocolVersion: '1.0',
      outboxPending: 0,
    });
  });

  it('serves the active design session to local MCP clients without CORS exposure', async () => {
    const homeDir = makeHome();
    await writeActiveDesignSession(
      {
        workflowRunId: 'workflow-1',
        executionSessionId: 'session-1',
        apiBaseUrl: 'http://127.0.0.1:3000',
        accessToken: 'token-1',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        stage: 'design',
      },
      homeDir,
    );
    const { server, url } = await startServer({ port: 0, homeDir });
    servers.push(server);

    const response = await fetch(`${url}/design/active-session`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      workflowRunId: 'workflow-1',
      executionSessionId: 'session-1',
      accessToken: 'token-1',
    });
  });

  it('accepts CORS preflight and launches with the web supplied API base', async () => {
    const runLaunch = async (input: {
      ticket: string;
      ide: 'cursor' | 'codex';
      apiBaseUrl: string;
    }) => ({
      ok: true as const,
      gitRoot: '/work/repo',
      ide: input.ide,
      prefilled: false,
      promptPath: '/work/repo/.flowx/tasks/workflow-1.md',
    });
    const server = createLocalServer({ runLaunch, homeDir: makeHome() });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    const url = `http://127.0.0.1:${address.port}`;

    const preflight = await fetch(`${url}/launch`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');

    const response = await fetch(`${url}/launch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ticket: 'ticket-1',
        ide: 'cursor',
        apiBaseUrl: 'https://flowx.example',
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      gitRoot: '/work/repo',
      ide: 'cursor',
    });
  });

  it('accepts OpenDesign launch and submit requests', async () => {
    const runOpenDesignLaunch = async () => ({
      ok: true as const,
      executionSessionId: 'session-1',
      workflowRunId: 'workflow-1',
      workspacePath: '/tmp/design',
      contextPath: '/tmp/design/context.json',
      resultPath: '/tmp/design/result.json',
      opened: true,
      imported: false,
      activeDesignPath: '/tmp/.flowx/active-design.json',
      stage: 'design' as const,
    });
    const submitOpenDesignResult = async () => ({ queued: false });
    const server = createLocalServer({
      homeDir: makeHome(),
      runOpenDesignLaunch,
      submitOpenDesignResult,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    const url = `http://127.0.0.1:${address.port}`;

    const launch = await fetch(`${url}/design/launch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: 'ticket-1', apiBaseUrl: 'http://127.0.0.1:3000' }),
    });
    await expect(launch.json()).resolves.toMatchObject({
      ok: true,
      executionSessionId: 'session-1',
    });

    const submit = await fetch(`${url}/design/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ executionSessionId: 'session-1' }),
    });
    await expect(submit.json()).resolves.toEqual({ queued: false });
  });
});
