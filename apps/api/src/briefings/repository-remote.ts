export type BriefingProvider = 'github' | 'gitlab';

export interface ParsedRepositoryRemote {
  provider: BriefingProvider;
  externalPath: string;
  host: string;
}

function normalizePath(pathname: string) {
  return pathname
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\.git$/i, '');
}

function parseHttpsRemote(url: string): ParsedRepositoryRemote | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const path = normalizePath(parsed.pathname);
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  if (host === 'github.com') {
    return {
      provider: 'github',
      externalPath: `${segments[0]}/${segments[1]}`,
      host,
    };
  }

  return {
    provider: 'gitlab',
    externalPath: path,
    host,
  };
}

function parseScpStyleRemote(url: string): ParsedRepositoryRemote | null {
  const match = url.match(/^git@([^:]+):(.+)$/i);
  if (!match) {
    return null;
  }

  const host = match[1].toLowerCase();
  const path = normalizePath(`/${match[2]}`);
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  if (host === 'github.com') {
    return {
      provider: 'github',
      externalPath: `${segments[0]}/${segments[1]}`,
      host,
    };
  }

  return {
    provider: 'gitlab',
    externalPath: path,
    host,
  };
}

export function parseRepositoryRemote(url: string): ParsedRepositoryRemote | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('git@')) {
    return parseScpStyleRemote(trimmed);
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('ssh://')) {
    return parseHttpsRemote(trimmed);
  }

  return null;
}
