import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readActiveDesignSession } from './active-design-session.js';
import { DEFAULT_LOCAL_CONFIG } from './config.js';

export type LocalCredentials = {
  apiBaseUrl: string;
  apiToken: string;
  updatedAt: string;
};

export type ApiAuthSource = 'env' | 'credentials' | 'active-design';

export type ResolvedApiAuth = {
  apiBaseUrl: string;
  apiToken: string;
  source: ApiAuthSource;
};

export function getCredentialsPath(homeDir = homedir()): string {
  return join(homeDir, '.flowx', 'credentials.json');
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function asCredentials(parsed: Partial<LocalCredentials>): LocalCredentials | null {
  const apiBaseUrl =
    typeof parsed.apiBaseUrl === 'string' ? normalizeBaseUrl(parsed.apiBaseUrl) : '';
  const apiToken = typeof parsed.apiToken === 'string' ? parsed.apiToken.trim() : '';
  if (!apiBaseUrl || !apiToken) {
    return null;
  }
  return {
    apiBaseUrl,
    apiToken,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
  };
}

export async function readCredentials(homeDir = homedir()): Promise<LocalCredentials | null> {
  try {
    const parsed = JSON.parse(await readFile(getCredentialsPath(homeDir), 'utf8')) as Partial<LocalCredentials>;
    return asCredentials(parsed);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    return null;
  }
}

export async function writeCredentials(
  input: { apiBaseUrl: string; apiToken: string; updatedAt?: string },
  homeDir = homedir(),
): Promise<string> {
  const path = getCredentialsPath(homeDir);
  await mkdir(dirname(path), { recursive: true });
  const body: LocalCredentials = {
    apiBaseUrl: normalizeBaseUrl(input.apiBaseUrl),
    apiToken: input.apiToken.trim(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
  if (!body.apiBaseUrl || !body.apiToken) {
    throw new Error('apiBaseUrl and apiToken are required.');
  }
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export async function clearCredentials(homeDir = homedir()): Promise<boolean> {
  try {
    await rm(getCredentialsPath(homeDir), { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function resolveApiAuth(homeDir = homedir()): Promise<ResolvedApiAuth> {
  const envToken = process.env.FLOWX_API_TOKEN?.trim() ?? '';
  const envBaseUrl = process.env.FLOWX_API_BASE_URL?.trim()
    ? normalizeBaseUrl(process.env.FLOWX_API_BASE_URL)
    : '';
  const credentials = await readCredentials(homeDir);
  const active = await readActiveDesignSession(homeDir);

  if (envToken) {
    const apiBaseUrl =
      envBaseUrl ||
      credentials?.apiBaseUrl ||
      active?.apiBaseUrl ||
      DEFAULT_LOCAL_CONFIG.apiBaseUrl;
    if (!apiBaseUrl) {
      throw new Error(
        'No FlowX API URL is available. Set FLOWX_API_BASE_URL or run `flowx-local login`.',
      );
    }
    return { apiBaseUrl, apiToken: envToken, source: 'env' };
  }

  if (credentials) {
    return {
      apiBaseUrl: credentials.apiBaseUrl,
      apiToken: credentials.apiToken,
      source: 'credentials',
    };
  }

  if (active?.accessToken?.trim() && active.apiBaseUrl) {
    return {
      apiBaseUrl: active.apiBaseUrl,
      apiToken: active.accessToken.trim(),
      source: 'active-design',
    };
  }

  throw new Error(
    'No FlowX credentials found. Run `flowx-local login`, set FLOWX_API_TOKEN, or open local OpenDesign from FlowX.',
  );
}
