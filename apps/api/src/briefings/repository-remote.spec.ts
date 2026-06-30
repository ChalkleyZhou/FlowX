import { describe, expect, it } from 'vitest';
import { parseRepositoryRemote, buildCloneUrl } from './repository-remote';

describe('parseRepositoryRemote', () => {
  it('parses GitHub https remotes', () => {
    expect(parseRepositoryRemote('https://github.com/rokid/flowx.git')).toEqual({
      provider: 'github',
      externalPath: 'rokid/flowx',
      host: 'github.com',
      protocol: 'https',
    });
  });

  it('parses GitHub scp-style remotes', () => {
    expect(parseRepositoryRemote('git@github.com:rokid/flowx.git')).toEqual({
      provider: 'github',
      externalPath: 'rokid/flowx',
      host: 'github.com',
      protocol: 'https',
    });
  });

  it('parses GitLab https remotes with nested groups', () => {
    expect(parseRepositoryRemote('https://gitlab.example.com/rokid/platform/flowx.git')).toEqual({
      provider: 'gitlab',
      externalPath: 'rokid/platform/flowx',
      host: 'gitlab.example.com',
      protocol: 'https',
    });
  });

  it('parses self-hosted GitLab remotes with explicit https port', () => {
    expect(parseRepositoryRemote('https://ops.r2d2cn.com:1022/r2/platform/r2crm.git')).toEqual({
      provider: 'gitlab',
      externalPath: 'r2/platform/r2crm',
      host: 'ops.r2d2cn.com',
      port: 1022,
      protocol: 'https',
    });
  });

  it('parses self-hosted GitLab remotes with explicit http port', () => {
    expect(parseRepositoryRemote('http://ops.r2d2cn.com:1022/r2/platform/r2crm.git')).toEqual({
      provider: 'gitlab',
      externalPath: 'r2/platform/r2crm',
      host: 'ops.r2d2cn.com',
      port: 1022,
      protocol: 'http',
    });
  });

  it('parses scp-style remotes where port was mistakenly placed before group path', () => {
    expect(parseRepositoryRemote('git@ops.r2d2cn.com:1022:r2/platform/r2crm.git')).toEqual({
      provider: 'gitlab',
      externalPath: 'r2/platform/r2crm',
      host: 'ops.r2d2cn.com',
      port: 1022,
      protocol: 'http',
    });
  });

  it('builds http clone urls for self-hosted gitlab on custom ports', () => {
    expect(buildCloneUrl('git@ops.r2d2cn.com:1022:r2/platform/r2crm.git')).toBe(
      'http://ops.r2d2cn.com:1022/r2/platform/r2crm.git',
    );
    expect(buildCloneUrl('http://ops.r2d2cn.com:1022/r2/platform/r2crm.git')).toBe(
      'http://ops.r2d2cn.com:1022/r2/platform/r2crm.git',
    );
  });

  it('repairs malformed https remotes where port was embedded in the path', () => {
    expect(parseRepositoryRemote('https://ops.r2d2cn.com/1022:r2/platform/r2crm.git')).toEqual({
      provider: 'gitlab',
      externalPath: 'r2/platform/r2crm',
      host: 'ops.r2d2cn.com',
      port: 1022,
      protocol: 'http',
    });
    expect(buildCloneUrl('https://ops.r2d2cn.com/1022:r2/platform/r2crm.git')).toBe(
      'http://ops.r2d2cn.com:1022/r2/platform/r2crm.git',
    );
  });

  it('returns null for unsupported remotes', () => {
    expect(parseRepositoryRemote('not-a-remote')).toBeNull();
  });
});
