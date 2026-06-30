import { describe, expect, it } from 'vitest';
import { parseRepositoryRemote, buildHttpsCloneUrl } from './repository-remote';

describe('parseRepositoryRemote', () => {
  it('parses GitHub https remotes', () => {
    expect(parseRepositoryRemote('https://github.com/rokid/flowx.git')).toEqual({
      provider: 'github',
      externalPath: 'rokid/flowx',
      host: 'github.com',
    });
  });

  it('parses GitHub scp-style remotes', () => {
    expect(parseRepositoryRemote('git@github.com:rokid/flowx.git')).toEqual({
      provider: 'github',
      externalPath: 'rokid/flowx',
      host: 'github.com',
    });
  });

  it('parses GitLab https remotes with nested groups', () => {
    expect(parseRepositoryRemote('https://gitlab.example.com/rokid/platform/flowx.git')).toEqual({
      provider: 'gitlab',
      externalPath: 'rokid/platform/flowx',
      host: 'gitlab.example.com',
    });
  });

  it('parses self-hosted GitLab remotes with explicit https port', () => {
    expect(parseRepositoryRemote('https://ops.r2d2cn.com:1022/r2/platform/r2crm.git')).toEqual({
      provider: 'gitlab',
      externalPath: 'r2/platform/r2crm',
      host: 'ops.r2d2cn.com',
      port: 1022,
    });
  });

  it('parses scp-style remotes where port was mistakenly placed before group path', () => {
    expect(parseRepositoryRemote('git@ops.r2d2cn.com:1022:r2/platform/r2crm.git')).toEqual({
      provider: 'gitlab',
      externalPath: 'r2/platform/r2crm',
      host: 'ops.r2d2cn.com',
      port: 1022,
    });
  });

  it('builds https clone urls with non-default ports', () => {
    expect(buildHttpsCloneUrl('git@ops.r2d2cn.com:1022:r2/platform/r2crm.git')).toBe(
      'https://ops.r2d2cn.com:1022/r2/platform/r2crm.git',
    );
  });

  it('repairs malformed https remotes where port was embedded in the path', () => {
    expect(parseRepositoryRemote('https://ops.r2d2cn.com/1022:r2/platform/r2crm.git')).toEqual({
      provider: 'gitlab',
      externalPath: 'r2/platform/r2crm',
      host: 'ops.r2d2cn.com',
      port: 1022,
    });
    expect(buildHttpsCloneUrl('https://ops.r2d2cn.com/1022:r2/platform/r2crm.git')).toBe(
      'https://ops.r2d2cn.com:1022/r2/platform/r2crm.git',
    );
  });

  it('returns null for unsupported remotes', () => {
    expect(parseRepositoryRemote('not-a-remote')).toBeNull();
  });
});
