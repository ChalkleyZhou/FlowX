import { describe, expect, it } from 'vitest';
import { parseRepositoryRemote } from './repository-remote';

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

  it('returns null for unsupported remotes', () => {
    expect(parseRepositoryRemote('not-a-remote')).toBeNull();
  });
});
