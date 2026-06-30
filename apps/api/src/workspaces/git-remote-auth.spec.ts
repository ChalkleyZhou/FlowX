import { describe, expect, it } from 'vitest';
import {
  applyHttpAccessTokenToCloneUrl,
  buildGitAuthEnv,
  buildGitHttpExtraHeader,
  buildGitHttpExtraHeaders,
  resolveGitRemoteAuth,
} from './git-remote-auth';

describe('git-remote-auth', () => {
  it('builds github authorization header', () => {
    const encoded = Buffer.from('x-access-token:ghp_test').toString('base64');
    expect(buildGitHttpExtraHeader('github', 'ghp_test')).toBe(`Authorization: Basic ${encoded}`);
  });

  it('builds gitlab private token and basic auth headers', () => {
    expect(buildGitHttpExtraHeaders('gitlab', 'glpat-test')).toEqual([
      'PRIVATE-TOKEN: glpat-test',
      `Authorization: Basic ${Buffer.from('oauth2:glpat-test').toString('base64')}`,
    ]);
  });

  it('applies http auth only for http(s) remotes', () => {
    expect(resolveGitRemoteAuth('https://gitlab.example.com/group/project.git', 'glpat-test')).toEqual({
      provider: 'gitlab',
      token: 'glpat-test',
    });
    expect(
      resolveGitRemoteAuth('ssh://git@gitlab.example.com:1022/group/project.git', 'glpat-test'),
    ).toBeNull();
    expect(resolveGitRemoteAuth('git@gitlab.example.com:group/project.git', 'glpat-test')).toBeNull();
  });

  it('embeds oauth2 credentials into gitlab http clone url', () => {
    const auth = resolveGitRemoteAuth('http://ops.r2d2cn.com:1080/r2/platform/r2crm.git', 'glpat-test');
    expect(applyHttpAccessTokenToCloneUrl('http://ops.r2d2cn.com:1080/r2/platform/r2crm.git', auth)).toBe(
      'http://oauth2:glpat-test@ops.r2d2cn.com:1080/r2/platform/r2crm.git',
    );
  });

  it('injects git auth env for http clone and fetch', () => {
    const auth = resolveGitRemoteAuth('https://github.com/acme/demo.git', 'ghp_test');
    const env = buildGitAuthEnv(auth);
    expect(env.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toContain('Authorization: Basic');
  });
});
