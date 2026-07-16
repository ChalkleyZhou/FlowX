import { createServer, type Server } from 'node:http';
import { DEFAULT_PORT, PACKAGE_VERSION, loadConfig, type ConfigOptions } from './config.js';

export type StartServerOptions = ConfigOptions & {
  port?: number;
  version?: string;
};

export type StartedServer = {
  server: Server;
  url: string;
  port: number;
};

export function createLocalServer(options: StartServerOptions = {}): Server {
  const version = options.version ?? PACKAGE_VERSION;

  return createServer((req, res) => {
    const method = req.method ?? 'GET';
    const path = req.url?.split('?')[0] ?? '/';

    if (method === 'GET' && path === '/health') {
      const body = JSON.stringify({ ok: true, version });
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<StartedServer> {
  const config = loadConfig(options);
  const port = options.port ?? config.port ?? DEFAULT_PORT;
  const server = createLocalServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind flowx-local server');
  }

  const url = `http://127.0.0.1:${address.port}`;
  return { server, url, port: address.port };
}
