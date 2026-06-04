import { describe, expect, it } from 'vitest';
import {
  matchRepository,
  normalizeRemoteUrl,
  resolveWorkspacePath,
} from './repo-match';

describe('normalizeRemoteUrl', () => {
  it('normalizes https remotes', () => {
    expect(normalizeRemoteUrl('https://github.com/FlowX-AI/FlowX.git')).toBe('github.com/flowx-ai/flowx');
  });

  it('normalizes ssh shorthand remotes', () => {
    expect(normalizeRemoteUrl('git@github.com:FlowX-AI/FlowX.git')).toBe('github.com/flowx-ai/flowx');
  });

  it('normalizes ssh URL remotes', () => {
    expect(normalizeRemoteUrl('ssh://git@gitlab.example.com/team/FlowX.git/')).toBe(
      'gitlab.example.com/team/flowx',
    );
  });
});

describe('matchRepository', () => {
  it('matches equivalent repository remotes', () => {
    expect(matchRepository('https://github.com/FlowX-AI/FlowX.git', 'git@github.com:flowx-ai/flowx.git')).toEqual({
      currentRemote: 'github.com/flowx-ai/flowx',
      expectedRemote: 'github.com/flowx-ai/flowx',
      match: true,
    });
  });

  it('reports mismatched remotes', () => {
    expect(matchRepository('https://github.com/FlowX-AI/FlowX.git', 'git@github.com:flowx-ai/other.git')).toEqual({
      currentRemote: 'github.com/flowx-ai/other',
      expectedRemote: 'github.com/flowx-ai/flowx',
      match: false,
    });
  });

  it('fails closed when a task has no repository url', () => {
    expect(matchRepository(null, 'git@github.com:flowx-ai/flowx.git')).toEqual({
      currentRemote: 'github.com/flowx-ai/flowx',
      expectedRemote: null,
      match: false,
    });
  });
});

describe('resolveWorkspacePath', () => {
  it('returns the first workspace path', () => {
    expect(resolveWorkspacePath(['/repo/a', '/repo/b'])).toBe('/repo/a');
  });

  it('returns null when no workspace is open', () => {
    expect(resolveWorkspacePath([])).toBeNull();
  });
});
