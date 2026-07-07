import { describe, expect, it } from 'vitest';
import type { BriefingCommit } from './briefing-commits';
import {
  buildRepositoryLookup,
  groupCommitsForDailyReview,
  resolveRepositoryForCommit,
} from './daily-code-review-commits';

function commit(input: Partial<BriefingCommit> & Pick<BriefingCommit, 'id' | 'message'>): BriefingCommit {
  return {
    projectName: 'flowx-api',
    occurredAt: '2026-07-07T10:00:00.000Z',
    ...input,
  };
}

describe('groupCommitsForDailyReview', () => {
  it('groups commits by repository and ref', () => {
    const groups = groupCommitsForDailyReview([
      commit({ id: 'a1', message: 'feat: one', ref: 'main' }),
      commit({ id: 'a2', message: 'fix: two', ref: 'main' }),
      commit({ id: 'b1', message: 'feat: branch', ref: 'feature/login' }),
      commit({ id: 'c1', message: 'chore: unknown', projectName: 'flowx-web' }),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({
      repositoryName: 'flowx-api',
      ref: 'feature/login',
      commits: [expect.objectContaining({ id: 'b1' })],
    });
    expect(groups[1]).toMatchObject({
      repositoryName: 'flowx-api',
      ref: 'main',
      commits: [
        expect.objectContaining({ id: 'a1' }),
        expect.objectContaining({ id: 'a2' }),
      ],
    });
    expect(groups[2]).toMatchObject({
      repositoryName: 'flowx-web',
      ref: 'unknown',
    });
  });
});

describe('resolveRepositoryForCommit', () => {
  it('matches repositories case-insensitively', () => {
    const lookup = buildRepositoryLookup([
      { id: 'repo-1', name: 'FlowX-API', url: 'https://example.com/a.git', defaultBranch: 'main', currentBranch: 'main', localPath: '/tmp/flowx-api', syncStatus: 'READY' },
    ]);

    expect(resolveRepositoryForCommit('flowx-api', lookup)?.id).toBe('repo-1');
  });
});
