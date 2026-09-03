export type ApiBaseUrlSource = 'flag' | 'env' | 'config';

export type ResolvedApiBaseUrl =
  | { url: string; source: ApiBaseUrlSource }
  | { url: null; source: 'missing' };

export function normalizeApiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

const PLACEHOLDERS = new Set(['http://127.0.0.1:3000', 'http://localhost:3000']);

export function isPlaceholderApiBaseUrl(url: string): boolean {
  return PLACEHOLDERS.has(normalizeApiBaseUrl(url));
}

export function isConfirmedApiBaseUrl(url: string | undefined): boolean {
  const normalized = normalizeApiBaseUrl(url ?? '');
  return normalized.length > 0 && !isPlaceholderApiBaseUrl(normalized);
}

export function resolveApiBaseUrl(input: {
  flag?: string;
  env?: string;
  config?: string;
}): ResolvedApiBaseUrl {
  const flag = input.flag?.trim() ? normalizeApiBaseUrl(input.flag) : '';
  if (flag) {
    return { url: flag, source: 'flag' };
  }
  const env = input.env?.trim() ? normalizeApiBaseUrl(input.env) : '';
  if (env) {
    return { url: env, source: 'env' };
  }
  const config = input.config?.trim() ? normalizeApiBaseUrl(input.config) : '';
  if (isConfirmedApiBaseUrl(config)) {
    return { url: config, source: 'config' };
  }
  return { url: null, source: 'missing' };
}
