import { describe, expect, it, vi } from 'vitest';
import { parseGitLogOutput, RepositorySyncService } from './repository-sync.service';

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
