import { describe, expect, it, vi } from 'vitest';
import { RepositorySyncService } from './repository-sync.service';

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
