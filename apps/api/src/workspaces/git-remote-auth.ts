import { parseRepositoryRemote } from '../briefings/repository-remote';
import type { BriefingProvider } from '../briefings/repository-remote';
import type { GitCredentialProvider } from '../auth/git-credentials.service';

export type GitRemoteAuth = {
  provider: GitCredentialProvider;
  token: string;
};

export function isHttpRepositoryUrl(url: string) {
  const trimmed = url.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

export function resolveGitRemoteAuth(
  remoteUrl: string,
  token: string | null | undefined,
): GitRemoteAuth | null {
  if (!token?.trim() || !isHttpRepositoryUrl(remoteUrl)) {
    return null;
  }

  const parsed = parseRepositoryRemote(remoteUrl);
  if (!parsed) {
    return null;
  }

  return {
    provider: parsed.provider,
    token: token.trim(),
  };
}

export function applyHttpAccessTokenToCloneUrl(remoteUrl: string, auth: GitRemoteAuth | null) {
  const trimmed = remoteUrl.trim();
  if (!auth || !isHttpRepositoryUrl(trimmed)) {
    return trimmed;
  }

  const parsed = new URL(trimmed);
  parsed.username = auth.provider === 'github' ? 'x-access-token' : 'oauth2';
  parsed.password = auth.token;
  return parsed.toString();
}

export function buildGitAuthEnv(auth: GitRemoteAuth | null): NodeJS.ProcessEnv {
  if (!auth) {
    return {};
  }

  const headers = buildGitHttpExtraHeaders(auth.provider, auth.token);
  const env: NodeJS.ProcessEnv = {
    GIT_CONFIG_COUNT: String(headers.length),
  };

  headers.forEach((header, index) => {
    env[`GIT_CONFIG_KEY_${index}`] = 'http.extraHeader';
    env[`GIT_CONFIG_VALUE_${index}`] = header;
  });

  return env;
}

export function buildGitHttpExtraHeaders(provider: BriefingProvider, token: string) {
  if (provider === 'github') {
    const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
    return [`Authorization: Basic ${encoded}`];
  }

  const encoded = Buffer.from(`oauth2:${token}`).toString('base64');
  return [`PRIVATE-TOKEN: ${token}`, `Authorization: Basic ${encoded}`];
}

export function buildGitHttpExtraHeader(provider: BriefingProvider, token: string) {
  return buildGitHttpExtraHeaders(provider, token)[0]!;
}
