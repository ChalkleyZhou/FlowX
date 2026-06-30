export type BriefingProvider = 'github' | 'gitlab';
export type CloneProtocol = 'http' | 'https';

export interface ParsedRepositoryRemote {
  provider: BriefingProvider;
  externalPath: string;
  host: string;
  port?: number;
  protocol?: CloneProtocol;
}

function normalizePath(pathname: string) {
  return pathname
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\.git$/i, '');
}

function normalizePort(protocol: string, portValue: string | undefined) {
  if (!portValue) {
    return undefined;
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port <= 0) {
    return undefined;
  }

  if (protocol === 'https:' && port === 443) {
    return undefined;
  }
  if (protocol === 'http:' && port === 80) {
    return undefined;
  }
  if (protocol === 'ssh:' && port === 22) {
    return undefined;
  }

  return port;
}

function parseMisplacedPortInScpPath(rawPath: string) {
  const match = rawPath.match(/^(\d{2,5})[:/](.+)$/);
  if (!match) {
    return null;
  }

  return {
    port: Number(match[1]),
    repoPath: match[2]!,
  };
}

function inferCloneProtocol(host: string, options?: { port?: number; protocol?: CloneProtocol }) {
  if (options?.protocol) {
    return options.protocol;
  }

  if (host === 'github.com') {
    return 'https';
  }

  if (options?.port) {
    return 'http';
  }

  return 'https';
}

function buildParsedRemote(
  host: string,
  path: string,
  options?: { port?: number; protocol?: CloneProtocol },
): ParsedRepositoryRemote | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const protocol = inferCloneProtocol(host, options);

  if (host === 'github.com') {
    return {
      provider: 'github',
      externalPath: `${segments[0]}/${segments[1]}`,
      host,
      port: options?.port,
      protocol,
    };
  }

  return {
    provider: 'gitlab',
    externalPath: path,
    host,
    port: options?.port,
    protocol,
  };
}

function parseHttpsRemote(url: string): ParsedRepositoryRemote | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  let path = normalizePath(parsed.pathname);
  let port = normalizePort(parsed.protocol, parsed.port || undefined);
  let protocol: CloneProtocol = parsed.protocol === 'http:' ? 'http' : 'https';

  const misplacedPort = parseMisplacedPortInScpPath(path);
  if (misplacedPort) {
    path = normalizePath(`/${misplacedPort.repoPath}`);
    port = port ?? misplacedPort.port;
    if (host !== 'github.com' && !parsed.port) {
      protocol = 'http';
    }
  }

  return buildParsedRemote(host, path, { port, protocol });
}

function parseScpStyleRemote(url: string): ParsedRepositoryRemote | null {
  const match = url.match(/^git@([^:]+):(.+)$/i);
  if (!match) {
    return null;
  }

  const host = match[1].toLowerCase();
  const misplacedPort = parseMisplacedPortInScpPath(match[2]!);
  const path = misplacedPort
    ? normalizePath(`/${misplacedPort.repoPath}`)
    : normalizePath(`/${match[2]}`);

  return buildParsedRemote(host, path, {
    port: misplacedPort?.port,
  });
}

export function buildCloneUrl(remoteUrl: string): string | null {
  const parsed = parseRepositoryRemote(remoteUrl);
  if (!parsed) {
    return null;
  }

  const protocol = inferCloneProtocol(parsed.host, {
    port: parsed.port,
    protocol: parsed.protocol,
  });
  const portSuffix = parsed.port ? `:${parsed.port}` : '';
  return `${protocol}://${parsed.host}${portSuffix}/${parsed.externalPath}.git`;
}

/** @deprecated Use buildCloneUrl instead. */
export function buildHttpsCloneUrl(remoteUrl: string): string | null {
  return buildCloneUrl(remoteUrl);
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
