import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createLocalServer, startServer } from './server.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe('flowx-local server', () => {
  it('serves GET /health on loopback', async () => {
    const { server, url } = await startServer({ port: 0 });
    servers.push(server);

    expect(url.startsWith('http://127.0.0.1:')).toBe(true);

    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      version: '0.1.0',
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
    const server = createLocalServer({ runLaunch });
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
});
