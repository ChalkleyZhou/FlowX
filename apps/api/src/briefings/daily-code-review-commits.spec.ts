import { describe, expect, it } from 'vitest';
import type { BriefingCommit } from './briefing-commits';
import {
  buildRepositoryLookupById,
  buildRepositoryLookupByName,
  groupCommitsForDailyReview,
  resolveRepositoryForReview,
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

  it('groups by repositoryId when present even if projectName differs', () => {
    const groups = groupCommitsForDailyReview([
      commit({ id: 'a1', message: 'feat: one', projectName: 'r2crm', repositoryId: 'repo-r2', ref: 'main' }),
      commit({ id: 'a2', message: 'fix: two', projectName: 'r2crm', repositoryId: 'repo-r2', ref: 'main' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      repositoryId: 'repo-r2',
      repositoryName: 'r2crm',
      ref: 'main',
      commits: expect.arrayContaining([
        expect.objectContaining({ id: 'a1' }),
        expect.objectContaining({ id: 'a2' }),
      ]),
    });
  });
});

describe('resolveRepositoryForReview', () => {
  const repository = {
    id: 'repo-1',
    name: 'R2CRM-Backend',
    url: 'https://example.com/a.git',
    defaultBranch: 'main',
    currentBranch: 'main',
    localPath: '/tmp/r2crm',
    syncStatus: 'READY',
  };

  it('resolves by repositoryId when available', () => {
    const lookupById = buildRepositoryLookupById([repository]);
    const lookupByName = buildRepositoryLookupByName([repository]);

    expect(
      resolveRepositoryForReview(
        { repositoryId: 'repo-1', repositoryName: 'r2crm' },
        lookupById,
        lookupByName,
      )?.name,
    ).toBe('R2CRM-Backend');
  });

  it('falls back to name matching case-insensitively when repositoryId is absent', () => {
    const lookupById = buildRepositoryLookupById([repository]);
    const lookupByName = buildRepositoryLookupByName([repository]);

    expect(
      resolveRepositoryForReview(
        { repositoryId: null, repositoryName: 'r2crm-backend' },
        lookupById,
        lookupByName,
      )?.id,
    ).toBe('repo-1');
  });
});
