import { createServer, type Server } from 'node:http';
import { DEFAULT_PORT, PACKAGE_VERSION, loadConfig, type ConfigOptions } from './config.js';
import { runLaunch, type LaunchRequest } from './launch.js';

export type StartServerOptions = ConfigOptions & {
  port?: number;
  version?: string;
  runLaunch?: typeof runLaunch;
};

export type StartedServer = {
  server: Server;
  url: string;
  port: number;
};

function sendJson(
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
  cors = false,
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...(cors
      ? {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        }
      : {}),
  });
  res.end(text);
}

async function readJson(req: import('node:http').IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
  }
  return JSON.parse(body);
}

export function createLocalServer(options: StartServerOptions = {}): Server {
  const version = options.version ?? PACKAGE_VERSION;
  const launch = options.runLaunch ?? runLaunch;

  return createServer(async (req, res) => {
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

    if (path === '/launch' && method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    if (path === '/launch' && method === 'POST') {
      try {
        const body = (await readJson(req)) as Partial<LaunchRequest>;
        if (
          !body ||
          typeof body.ticket !== 'string' ||
          (body.ide !== 'cursor' && body.ide !== 'codex') ||
          typeof body.apiBaseUrl !== 'string'
        ) {
          sendJson(res, 400, { ok: false, error: 'ticket, ide, and apiBaseUrl are required' }, true);
          return;
        }
        sendJson(res, 200, await launch(body as LaunchRequest), true);
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? (error as { code?: string }).code
            : undefined;
        const message = error instanceof Error ? error.message : 'Launch failed';
        sendJson(
          res,
          code === 'REDEEM_FAILED' ? 502 : 400,
          { ok: false, error: code === 'PATH_CANCELLED' ? 'PATH_CANCELLED' : message },
          true,
        );
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
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
