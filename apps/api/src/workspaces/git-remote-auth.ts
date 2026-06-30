import {
  buildHttpsCloneUrl,
  parseRepositoryRemote,
  type BriefingProvider,
} from '../briefings/repository-remote';
import type { GitCredentialProvider } from '../auth/git-credentials.service';

export type GitRemoteAuth = {
  provider: GitCredentialProvider;
  token: string;
};

export function resolveGitRemoteAuth(
  remoteUrl: string,
  token: string | null | undefined,
): GitRemoteAuth | null {
  if (!token?.trim()) {
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

export function toHttpsCloneUrl(remoteUrl: string): string | null {
  return buildHttpsCloneUrl(remoteUrl);
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

export function resolveCloneUrl(remoteUrl: string, auth: GitRemoteAuth | null) {
  const trimmed = remoteUrl.trim();
  if (!auth) {
    return trimmed;
  }

  const normalizedHttpsUrl = toHttpsCloneUrl(trimmed);
  if (normalizedHttpsUrl) {
    return normalizedHttpsUrl;
  }

  return trimmed;
}

export function shouldNormalizeRemoteToHttps(remoteUrl: string, auth: GitRemoteAuth | null) {
  if (!auth) {
    return false;
  }

  const trimmed = remoteUrl.trim();
  return trimmed.startsWith('git@') || trimmed.startsWith('ssh://');
}
