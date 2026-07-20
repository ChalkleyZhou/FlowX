import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { parseGitLogOutput, RepositorySyncService } from './repository-sync.service';

describe('RepositorySyncService code review sandbox', () => {
  const originalCodeReviewReposRoot = process.env.CODE_REVIEW_REPOS_ROOT;

  afterEach(() => {
    if (originalCodeReviewReposRoot === undefined) {
      delete process.env.CODE_REVIEW_REPOS_ROOT;
    } else {
      process.env.CODE_REVIEW_REPOS_ROOT = originalCodeReviewReposRoot;
    }
  });

  function createService(prisma = { repository: { update: vi.fn().mockResolvedValue({}) } }) {
    return {
      prisma,
      service: new RepositorySyncService(prisma as never, {
        getAccessTokenForProvider: vi.fn().mockResolvedValue(null),
      } as never),
    };
  }

  it('resolves code review sandbox path under code-review/workspaces', () => {
    delete process.env.CODE_REVIEW_REPOS_ROOT;
    const { service } = createService();
    const repositoryId = 'repoabcd12345678';
    const path = (service as any).resolveCodeReviewRepositoryPath(
      'ws-abc',
      repositoryId,
      'My Demo Repo',
    );

    expect(path).toContain(join('code-review', 'workspaces', 'ws-abc', 'repositories'));
    expect(path.endsWith(`my-demo-repo-${repositoryId.slice(0, 8)}`)).toBe(true);
  });

  it('uses CODE_REVIEW_REPOS_ROOT when set', () => {
    process.env.CODE_REVIEW_REPOS_ROOT = '/tmp/cr-root';
    const { service } = createService();
    const repositoryId = 'repoabcd12345678';
    const path = (service as any).resolveCodeReviewRepositoryPath(
      'ws-abc',
      repositoryId,
      'demo',
    );

    expect(path).toBe(
      join('/tmp/cr-root', 'ws-abc', 'repositories', `demo-${repositoryId.slice(0, 8)}`),
    );
  });

  it('ensureCodeReviewSandbox does not update Repository.localPath', async () => {
    delete process.env.CODE_REVIEW_REPOS_ROOT;
    const { prisma, service } = createService();
    const repository = {
      id: 'repoabcd12345678',
      workspaceId: 'ws-abc',
      name: 'demo',
      url: 'git@example.com:org/demo.git',
      defaultBranch: 'main',
      currentBranch: 'main',
    };
    const sandboxPath = (service as any).resolveCodeReviewRepositoryPath(
      repository.workspaceId,
      repository.id,
      repository.name,
    );

    vi.spyOn(service as any, 'pathExists').mockImplementation(async (path: string) => {
      if (path === join(sandboxPath, '.git')) {
        return true;
      }
      return false;
    });
    vi.spyOn(service as any, 'resolveRemoteAuth').mockResolvedValue(null);
    vi.spyOn(service as any, 'runGit').mockResolvedValue('');
    vi.spyOn(service as any, 'remoteBranchExists').mockResolvedValue(true);
    vi.spyOn(service as any, 'removeStaleIndexLock').mockResolvedValue(undefined);

    const result = await service.ensureCodeReviewSandbox(repository, 'feature/cr');

    expect(result).toMatchObject({
      localPath: sandboxPath,
      branch: 'feature/cr',
      syncStatus: 'READY',
    });
    expect(prisma.repository.update).not.toHaveBeenCalled();
  });
});

describe('RepositorySyncService scheduling', () => {
  it('does not schedule duplicate syncs for the same repository', async () => {
    const prisma = {
      repository: {
        update: vi.fn().mockResolvedValue({}),
      },
    } as any;
    const service = new RepositorySyncService(prisma, {
      getAccessTokenForProvider: vi.fn().mockResolvedValue(null),
    } as never);
    const repository = {
      id: 'repo-1',
      workspaceId: 'ws-1',
      name: 'demo',
      url: 'https://example.com/demo.git',
      defaultBranch: 'main',
      currentBranch: 'main',
      localPath: null,
    };

    const syncSpy = vi.spyOn(service, 'syncRepository').mockImplementation(
      () =>
        new Promise(() => {
          // never resolves — simulates in-flight clone
        }),
    );

    service.scheduleRepositorySync(repository);
    service.scheduleRepositorySync(repository);

    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
});

describe('RepositorySyncService.collectRecentCommits', () => {
  it('throws when the repository fails to sync', async () => {
    const prisma = {
      repository: {
        update: vi.fn().mockResolvedValue({}),
      },
    } as any;
    const service = new RepositorySyncService(prisma, {
      getAccessTokenForProvider: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(service, 'syncRepository').mockResolvedValue({
      syncStatus: 'ERROR',
      syncError: 'clone failed',
      localPath: null,
    } as never);

    await expect(
      service.collectRecentCommits(
        {
          id: 'repo-1',
          workspaceId: 'ws-1',
          name: 'demo',
          url: 'https://example.com/demo.git',
          defaultBranch: 'main',
          currentBranch: 'main',
          localPath: null,
        },
        { branch: 'main', since: new Date('2026-07-07T00:00:00.000Z'), until: new Date('2026-07-08T00:00:00.000Z') },
      ),
    ).rejects.toThrow('clone failed');
  });
});

describe('RepositorySyncService.collectRecentCommitsFromLocalPath', () => {
  it('runs git log in the given path without syncing the repository', async () => {
    const prisma = {
      repository: {
        update: vi.fn().mockResolvedValue({}),
      },
    } as any;
    const service = new RepositorySyncService(prisma, {
      getAccessTokenForProvider: vi.fn().mockResolvedValue(null),
    } as never);
    const syncSpy = vi.spyOn(service, 'syncRepository');
    const fieldSep = '\x1f';
    const readGitLogStdout = vi.spyOn(service as any, 'readGitLogStdout').mockResolvedValue(
      `abc111${fieldSep}dev${fieldSep}2026-07-07T09:00:00.000Z${fieldSep}feat: sandbox only`,
    );

    const result = await service.collectRecentCommitsFromLocalPath('/tmp/code-review/demo', {
      branch: 'main',
      since: new Date('2026-07-07T00:00:00.000Z'),
      until: new Date('2026-07-08T00:00:00.000Z'),
    });

    expect(syncSpy).not.toHaveBeenCalled();
    expect(readGitLogStdout).toHaveBeenCalledWith(
      expect.arrayContaining([
        'log',
        'main',
        '--since=2026-07-07T00:00:00.000Z',
        '--until=2026-07-08T00:00:00.000Z',
      ]),
      '/tmp/code-review/demo',
    );
    expect(result).toEqual([
      {
        id: 'abc111',
        message: 'feat: sandbox only',
        author: 'dev',
        occurredAt: '2026-07-07T09:00:00.000Z',
      },
    ]);
  });
});

describe('parseGitLogOutput', () => {
  it('parses commit id, author, date and message from git log output', () => {
    const fieldSep = '\x1f';
    const stdout = [
      `aaa111${fieldSep}Alice${fieldSep}2026-07-07T09:00:00+08:00${fieldSep}feat: first commit`,
      `bbb222${fieldSep}Bob${fieldSep}2026-07-07T10:00:00+08:00${fieldSep}fix: second commit`,
    ].join('\n');

    expect(parseGitLogOutput(stdout, '2026-07-07T00:00:00.000Z')).toEqual([
      { id: 'aaa111', message: 'feat: first commit', author: 'Alice', occurredAt: '2026-07-07T09:00:00+08:00' },
      { id: 'bbb222', message: 'fix: second commit', author: 'Bob', occurredAt: '2026-07-07T10:00:00+08:00' },
    ]);
  });

  it('falls back to the provided timestamp and skips blank lines', () => {
    const fieldSep = '\x1f';
    const stdout = `\n\nccc333${fieldSep}${fieldSep}${fieldSep}chore: no author or date\n`;

    expect(parseGitLogOutput(stdout, '2026-07-07T00:00:00.000Z')).toEqual([
      {
        id: 'ccc333',
        message: 'chore: no author or date',
        author: undefined,
        occurredAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
  });

  it('returns an empty array for empty output', () => {
    expect(parseGitLogOutput('', '2026-07-07T00:00:00.000Z')).toEqual([]);
  });
});
