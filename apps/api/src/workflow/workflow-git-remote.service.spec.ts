import { describe, expect, it } from 'vitest';
import { buildGitRemoteVerificationEnv, compareRemoteSha } from './workflow-git-remote.service';

describe('compareRemoteSha', () => {
  it('returns true for exact match', () => {
    expect(compareRemoteSha('abc123def4567890', 'abc123def4567890')).toBe(true);
  });

  it('returns true when headSha is a short prefix', () => {
    expect(compareRemoteSha('abc123def4567890', 'abc123')).toBe(true);
  });

  it('returns false when tip mismatches', () => {
    expect(compareRemoteSha('ffffffffffffffffffffffffffffffffffffffff', 'abc123def4567890')).toBe(
      false,
    );
  });
});

describe('buildGitRemoteVerificationEnv', () => {
  it('adds GitLab authentication headers for HTTP remotes', () => {
    const env = buildGitRemoteVerificationEnv(
      'http://ops.r2d2cn.com:1080/security/frontend/security-platfrom.git',
      'glpat-test-token',
    );

    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toBe('PRIVATE-TOKEN: glpat-test-token');
    expect(env.GIT_CONFIG_KEY_1).toBe('http.extraHeader');
    expect(env.GIT_CONFIG_VALUE_1).toBe(
      `Authorization: Basic ${Buffer.from('oauth2:glpat-test-token').toString('base64')}`,
    );
  });

  it('does not add token headers when the remote has no usable token', () => {
    const env = buildGitRemoteVerificationEnv(
      'http://ops.r2d2cn.com:1080/security/frontend/security-platfrom.git',
      null,
    );

    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
  });
});
