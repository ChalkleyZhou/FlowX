import { parseRepositoryRemote } from '../briefings/repository-remote';
import type { BriefingProvider } from '../briefings/repository-remote';
import type { GitCredentialProvider } from '../auth/git-credentials.service';

export type GitRemoteAuth = {
  provider: GitCredentialProvider;
  token: string;
};

function isHttpRepositoryUrl(url: string) {
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

export function buildGitAuthEnv(auth: GitRemoteAuth | null): NodeJS.ProcessEnv {
  if (!auth) {
    return {};
  }

  const header = buildGitHttpExtraHeader(auth.provider, auth.token);
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: header,
  };
}

export function buildGitHttpExtraHeader(provider: BriefingProvider, token: string) {
  if (provider === 'github') {
    const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
    return `Authorization: Basic ${encoded}`;
  }

  return `PRIVATE-TOKEN: ${token}`;
}
