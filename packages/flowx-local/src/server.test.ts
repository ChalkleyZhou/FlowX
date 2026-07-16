import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startServer } from './server.js';

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
});
