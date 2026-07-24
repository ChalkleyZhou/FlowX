import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { FLOWX_PROTOCOL_VERSION } from '@flowx-ai/protocol';

export const DEFAULT_PORT = 3920;
export const PACKAGE_VERSION = '0.4.2';

export type DefaultIde = 'cursor' | 'codex';

export type LocalConfig = {
  port: number;
  repositories: Record<string, string>;
  defaultIde: DefaultIde;
  installationId: string;
  deviceId: string;
  apiBaseUrl: string;
  protocolVersion: string;
  openDesignCommand: string;
};

export const DEFAULT_LOCAL_CONFIG: LocalConfig = {
  port: DEFAULT_PORT,
  repositories: {},
  defaultIde: 'cursor',
  installationId: '',
  deviceId: '',
  apiBaseUrl: 'http://127.0.0.1:3000',
  protocolVersion: FLOWX_PROTOCOL_VERSION,
  openDesignCommand: '',
};

export type ConfigOptions = {
  homeDir?: string;
};

export function getConfigPath(options: ConfigOptions = {}): string {
  const home = options.homeDir ?? homedir();
  return join(home, '.flowx', 'local.json');
}

export function normalizeRepoUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid repository URL: ${raw}`);
  }

  parsed.username = '';
  parsed.password = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.search = '';
  parsed.hash = '';

  let pathname = parsed.pathname;
  if (pathname.endsWith('.git')) {
    pathname = pathname.slice(0, -'.git'.length);
  }
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  return `${parsed.protocol}//${parsed.host}${pathname === '/' ? '' : pathname}`;
}

function normalizeRepositories(
  repositories: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!repositories || typeof repositories !== 'object') {
    return result;
  }
  for (const [key, value] of Object.entries(repositories)) {
    if (typeof value !== 'string') {
      continue;
    }
    result[normalizeRepoUrl(key)] = value;
  }
  return result;
}

function normalizeConfig(raw: Partial<LocalConfig> | null | undefined): LocalConfig {
  const port =
    typeof raw?.port === 'number' && Number.isFinite(raw.port) && raw.port > 0
      ? Math.floor(raw.port)
      : DEFAULT_LOCAL_CONFIG.port;

  const defaultIde =
    raw?.defaultIde === 'codex' || raw?.defaultIde === 'cursor'
      ? raw.defaultIde
      : DEFAULT_LOCAL_CONFIG.defaultIde;

  return {
    port,
    repositories: normalizeRepositories(raw?.repositories),
    defaultIde,
    installationId: typeof raw?.installationId === 'string' ? raw.installationId.trim() : '',
    deviceId: typeof raw?.deviceId === 'string' ? raw.deviceId.trim() : '',
    apiBaseUrl:
      typeof raw?.apiBaseUrl === 'string' && raw.apiBaseUrl.trim()
        ? raw.apiBaseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_LOCAL_CONFIG.apiBaseUrl,
    protocolVersion:
      typeof raw?.protocolVersion === 'string' && raw.protocolVersion.trim()
        ? raw.protocolVersion.trim()
        : FLOWX_PROTOCOL_VERSION,
    openDesignCommand:
      typeof raw?.openDesignCommand === 'string' ? raw.openDesignCommand.trim() : '',
  };
}

export function loadConfig(options: ConfigOptions = {}): LocalConfig {
  const path = getConfigPath(options);
  try {
    const text = readFileSync(path, 'utf8');
    const parsed = JSON.parse(text) as Partial<LocalConfig>;
    return normalizeConfig(parsed);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return { ...DEFAULT_LOCAL_CONFIG, repositories: {} };
    }
    throw error;
  }
}

export function saveConfig(config: LocalConfig, options: ConfigOptions = {}): void {
  const normalized = normalizeConfig(config);
  const path = getConfigPath(options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}
