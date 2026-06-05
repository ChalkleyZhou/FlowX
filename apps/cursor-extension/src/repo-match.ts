import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RepositoryMatch {
  match: boolean;
  expectedRemote: string | null;
  currentRemote: string | null;
}

export function normalizeRemoteUrl(remoteUrl: string | null | undefined): string | null {
  const raw = remoteUrl?.trim();
  if (!raw) {
    return null;
  }

  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  const sshShorthand = withoutTrailingSlash.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (sshShorthand && !withoutTrailingSlash.includes('://')) {
    return normalizeRemoteParts(sshShorthand[1], sshShorthand[2]);
  }

  try {
    const url = new URL(withoutTrailingSlash);
    return normalizeRemoteParts(url.hostname, url.pathname);
  } catch {
    return stripGitSuffix(withoutTrailingSlash).toLowerCase();
  }
}

export function matchRepository(
  taskRemoteUrl: string | null | undefined,
  currentRemoteUrl: string | null | undefined,
  taskRepositoryName?: string | null,
): RepositoryMatch {
  const expectedRemote = normalizeRemoteUrl(taskRemoteUrl) ?? normalizeRepositoryName(taskRepositoryName);
  const currentRemote = normalizeRemoteUrl(currentRemoteUrl);

  return {
    currentRemote,
    expectedRemote,
    match: Boolean(
      expectedRemote &&
        currentRemote &&
        (expectedRemote === currentRemote || currentRemote.split('/').at(-1) === expectedRemote),
    ),
  };
}

export function resolveWorkspacePath(workspacePaths: readonly string[] | undefined): string | null {
  return workspacePaths?.[0] ?? null;
}

export async function getWorkspaceGitRoot(workspacePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: workspacePath });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getOriginRemoteUrl(gitRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: gitRoot });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function normalizeRemoteParts(host: string, path: string): string {
  const cleanHost = host.trim().toLowerCase();
  const cleanPath = stripGitSuffix(path.replace(/^\/+/, '').replace(/\/+$/, '')).toLowerCase();
  return `${cleanHost}/${cleanPath}`;
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git\/?$/i, '');
}

function normalizeRepositoryName(name: string | null | undefined): string | null {
  const cleanName = name?.trim();
  return cleanName ? stripGitSuffix(cleanName).toLowerCase() : null;
}
