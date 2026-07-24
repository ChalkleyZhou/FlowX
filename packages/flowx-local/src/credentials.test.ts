import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeActiveDesignSession } from './active-design-session.js';
import {
  clearCredentials,
  readCredentials,
  resolveApiAuth,
  writeCredentials,
} from './credentials.js';

const tempHomes: string[] = [];
const originalEnv = {
  FLOWX_API_TOKEN: process.env.FLOWX_API_TOKEN,
  FLOWX_API_BASE_URL: process.env.FLOWX_API_BASE_URL,
};

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'flowx-cred-'));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  while (tempHomes.length > 0) {
    const home = tempHomes.pop();
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  }
  if (originalEnv.FLOWX_API_TOKEN === undefined) {
    delete process.env.FLOWX_API_TOKEN;
  } else {
    process.env.FLOWX_API_TOKEN = originalEnv.FLOWX_API_TOKEN;
  }
  if (originalEnv.FLOWX_API_BASE_URL === undefined) {
    delete process.env.FLOWX_API_BASE_URL;
  } else {
    process.env.FLOWX_API_BASE_URL = originalEnv.FLOWX_API_BASE_URL;
  }
});

describe('credentials', () => {
  it('writes credentials.json with mode 0o600 and reads token', async () => {
    const home = makeHome();
    await writeCredentials({ apiBaseUrl: 'http://127.0.0.1:3000', apiToken: 'fxpat_x' }, home);
    const creds = await readCredentials(home);
    expect(creds?.apiToken).toBe('fxpat_x');
    expect(creds?.apiBaseUrl).toBe('http://127.0.0.1:3000');
    expect(typeof creds?.updatedAt).toBe('string');
    expect((await stat(join(home, '.flowx', 'credentials.json'))).mode & 0o777).toBe(0o600);
  });

  it('clearCredentials removes the credentials file', async () => {
    const home = makeHome();
    await writeCredentials({ apiBaseUrl: 'http://127.0.0.1:3000', apiToken: 'fxpat_x' }, home);
    await clearCredentials(home);
    expect(await readCredentials(home)).toBeNull();
  });
});

describe('resolveApiAuth', () => {
  it('prefers env Personal Token (fxpat_) over credentials', async () => {
    const home = makeHome();
    await writeCredentials({ apiBaseUrl: 'http://creds.example', apiToken: 'fxpat_creds' }, home);
    process.env.FLOWX_API_TOKEN = 'fxpat_env';
    delete process.env.FLOWX_API_BASE_URL;

    const auth = await resolveApiAuth(home);
    expect(auth).toEqual({
      apiBaseUrl: 'http://creds.example',
      apiToken: 'fxpat_env',
      source: 'env',
    });
  });

  it('prefers credentials over short-lived env token from Web launch', async () => {
    const home = makeHome();
    await writeCredentials({ apiBaseUrl: 'http://creds.example', apiToken: 'fxpat_creds' }, home);
    process.env.FLOWX_API_TOKEN = 'session-token-from-mcp-json';
    process.env.FLOWX_API_BASE_URL = 'http://env.example/';

    const auth = await resolveApiAuth(home);
    expect(auth).toEqual({
      apiBaseUrl: 'http://creds.example',
      apiToken: 'fxpat_creds',
      source: 'credentials',
    });
  });

  it('uses FLOWX_API_BASE_URL when env Personal Token is set', async () => {
    const home = makeHome();
    await writeCredentials({ apiBaseUrl: 'http://creds.example', apiToken: 'fxpat_creds' }, home);
    process.env.FLOWX_API_TOKEN = 'fxpat_env';
    process.env.FLOWX_API_BASE_URL = 'http://env.example/';

    const auth = await resolveApiAuth(home);
    expect(auth).toEqual({
      apiBaseUrl: 'http://env.example',
      apiToken: 'fxpat_env',
      source: 'env',
    });
  });

  it('falls back to credentials when env token is absent', async () => {
    const home = makeHome();
    await writeCredentials({ apiBaseUrl: 'http://creds.example', apiToken: 'fxpat_creds' }, home);
    await writeActiveDesignSession(
      {
        workflowRunId: 'wr-1',
        executionSessionId: 'es-1',
        apiBaseUrl: 'http://active.example',
        accessToken: 'session-token',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      },
      home,
    );
    delete process.env.FLOWX_API_TOKEN;
    delete process.env.FLOWX_API_BASE_URL;

    const auth = await resolveApiAuth(home);
    expect(auth).toEqual({
      apiBaseUrl: 'http://creds.example',
      apiToken: 'fxpat_creds',
      source: 'credentials',
    });
  });

  it('falls back to active-design when credentials are absent', async () => {
    const home = makeHome();
    await mkdir(join(home, '.flowx'), { recursive: true });
    await writeActiveDesignSession(
      {
        workflowRunId: 'wr-1',
        executionSessionId: 'es-1',
        apiBaseUrl: 'http://active.example',
        accessToken: 'session-token',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      },
      home,
    );
    delete process.env.FLOWX_API_TOKEN;
    delete process.env.FLOWX_API_BASE_URL;

    const auth = await resolveApiAuth(home);
    expect(auth).toEqual({
      apiBaseUrl: 'http://active.example',
      apiToken: 'session-token',
      source: 'active-design',
    });
  });

  it('skips expired active-design and asks for login', async () => {
    const home = makeHome();
    await mkdir(join(home, '.flowx'), { recursive: true });
    await writeActiveDesignSession(
      {
        workflowRunId: 'wr-1',
        executionSessionId: 'es-1',
        apiBaseUrl: 'http://active.example',
        accessToken: 'session-token',
        accessTokenExpiresAt: '2020-01-01T00:00:00.000Z',
      },
      home,
    );
    delete process.env.FLOWX_API_TOKEN;
    delete process.env.FLOWX_API_BASE_URL;

    await expect(resolveApiAuth(home)).rejects.toThrow(/expired|flowx-local login/);
  });

  it('throws a clear error when no credentials are available', async () => {
    const home = makeHome();
    delete process.env.FLOWX_API_TOKEN;
    delete process.env.FLOWX_API_BASE_URL;

    await expect(resolveApiAuth(home)).rejects.toThrow(
      /flowx-local login|FLOWX_API_TOKEN/,
    );
  });
});
