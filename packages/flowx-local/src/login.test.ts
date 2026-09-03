import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, saveConfig } from './config.js';
import { getCredentialsPath } from './credentials.js';
import { runLogin } from './login.js';

const homes: string[] = [];
const originalApiBaseUrl = process.env.FLOWX_API_BASE_URL;

beforeEach(() => {
  delete process.env.FLOWX_API_BASE_URL;
});

afterEach(() => {
  while (homes.length) {
    const home = homes.pop();
    if (home) rmSync(home, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  if (originalApiBaseUrl === undefined) {
    delete process.env.FLOWX_API_BASE_URL;
  } else {
    process.env.FLOWX_API_BASE_URL = originalApiBaseUrl;
  }
});

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'flowx-login-'));
  homes.push(home);
  return home;
}

describe('runLogin', () => {
  it('refuses to save when API URL is the historical placeholder and no flag is given', async () => {
    const home = makeHome();
    saveConfig(
      {
        port: 3920,
        repositories: {},
        defaultIde: 'cursor',
        installationId: 'i',
        deviceId: 'd',
        apiBaseUrl: 'http://127.0.0.1:3000',
        protocolVersion: '1',
        openDesignCommand: '',
      },
      { homeDir: home },
    );
    await expect(
      runLogin(['--token', 'fxpat_x'], { homeDir: home, promptApiBaseUrl: async () => '' }),
    ).rejects.toThrow(/apiBaseUrl/i);
    await expect(import('node:fs/promises').then((fs) => fs.readFile(getCredentialsPath(home), 'utf8'))).rejects.toThrow();
  });

  it('does not write credentials when token validation fails', async () => {
    const home = makeHome();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'nope' }),
    );
    await expect(
      runLogin(['--api-base-url', 'https://flowx.example/api', '--token', 'fxpat_bad'], { homeDir: home }),
    ).rejects.toThrow(/Token validation failed/);
    await expect(
      import('node:fs/promises').then((fs) => fs.access(getCredentialsPath(home))),
    ).rejects.toThrow();
  });

  it('does not write credentials when fetch fails to connect', async () => {
    const home = makeHome();
    saveConfig(
      {
        port: 3920,
        repositories: {},
        defaultIde: 'cursor',
        installationId: 'i',
        deviceId: 'd',
        apiBaseUrl: 'https://already.example/api',
        protocolVersion: '1',
        openDesignCommand: '',
      },
      { homeDir: home },
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(
      runLogin(['--api-base-url', 'https://flowx.example/api', '--token', 'fxpat_x'], {
        homeDir: home,
      }),
    ).rejects.toThrow(/fetch failed/);
    await expect(
      import('node:fs/promises').then((fs) => fs.access(getCredentialsPath(home))),
    ).rejects.toThrow();
    expect(loadConfig({ homeDir: home }).apiBaseUrl).toBe('https://already.example/api');
  });

  it('saves credentials and local.json apiBaseUrl on success', async () => {
    const home = makeHome();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
    await runLogin(['--api-base-url', 'https://flowx.example/api', '--token', 'fxpat_ok'], {
      homeDir: home,
    });
    const creds = JSON.parse(readFileSync(getCredentialsPath(home), 'utf8'));
    expect(creds.apiBaseUrl).toBe('https://flowx.example/api');
    expect(creds.apiToken).toBe('fxpat_ok');
    expect(loadConfig({ homeDir: home }).apiBaseUrl).toBe('https://flowx.example/api');
  });
});
