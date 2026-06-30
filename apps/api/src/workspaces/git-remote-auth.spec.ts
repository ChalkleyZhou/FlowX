import { describe, expect, it } from 'vitest';
import {
  buildGitAuthEnv,
  buildGitHttpExtraHeader,
  resolveCloneUrl,
  resolveGitRemoteAuth,
  toHttpsCloneUrl,
} from './git-remote-auth';

describe('git-remote-auth', () => {
  it('builds github authorization header', () => {
    const encoded = Buffer.from('x-access-token:ghp_test').toString('base64');
    expect(buildGitHttpExtraHeader('github', 'ghp_test')).toBe(`Authorization: Basic ${encoded}`);
  });

  it('builds gitlab private token header', () => {
    expect(buildGitHttpExtraHeader('gitlab', 'glpat-test')).toBe('PRIVATE-TOKEN: glpat-test');
  });

  it('converts scp-style remote to https clone url', () => {
    expect(toHttpsCloneUrl('git@github.com:acme/demo.git')).toBe('https://github.com/acme/demo.git');
    expect(toHttpsCloneUrl('git@gitlab.example.com:group/project.git')).toBe(
      'https://gitlab.example.com/group/project.git',
    );
  });

  it('uses https clone url for ssh remotes when auth is available', () => {
    const auth = resolveGitRemoteAuth('git@github.com:acme/demo.git', 'ghp_test');
    expect(resolveCloneUrl('git@github.com:acme/demo.git', auth)).toBe('https://github.com/acme/demo.git');
  });

  it('injects git auth env for clone and fetch', () => {
    const auth = resolveGitRemoteAuth('https://github.com/acme/demo.git', 'ghp_test');
    const env = buildGitAuthEnv(auth);
    expect(env.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toContain('Authorization: Basic');
  });
});
