import { describe, expect, it, vi } from 'vitest';
import { RepositorySyncRecoveryService } from './repository-sync-recovery.service';

describe('RepositorySyncRecoveryService', () => {
  it('reschedules stale syncing repositories on boot', async () => {
    const now = new Date('2026-06-03T10:10:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const staleRepository = {
      id: 'repo-1',
      workspaceId: 'ws-1',
      name: 'demo',
      url: 'https://example.com/demo.git',
      defaultBranch: 'main',
      currentBranch: 'main',
      localPath: null,
      updatedAt: new Date('2026-06-03T10:00:00.000Z'),
    };

    const prisma = {
      repository: {
        findMany: vi.fn().mockResolvedValue([staleRepository]),
      },
    } as any;
    const repositorySyncService = {
      scheduleRepositorySync: vi.fn(),
    } as any;
    const service = new RepositorySyncRecoveryService(prisma, repositorySyncService);

    await service.onModuleInit();

    expect(repositorySyncService.scheduleRepositorySync).toHaveBeenCalledWith(staleRepository);
    vi.useRealTimers();
  });

  it('skips fresh syncing repositories', async () => {
    const now = new Date('2026-06-03T10:10:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const prisma = {
      repository: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as any;
    const repositorySyncService = {
      scheduleRepositorySync: vi.fn(),
    } as any;
    const service = new RepositorySyncRecoveryService(prisma, repositorySyncService);

    await service.onModuleInit();

    expect(repositorySyncService.scheduleRepositorySync).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
