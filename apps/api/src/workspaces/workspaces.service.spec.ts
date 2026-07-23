import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService.updateRepository', () => {
  const existingRepository = {
    id: 'repo-1',
    workspaceId: 'workspace-1',
    name: 'flowx-web',
    url: 'https://git.example.com/old/flowx-web.git',
    defaultBranch: 'main',
    currentBranch: 'main',
    localPath: '/tmp/flowx-web',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function createService() {
    const prisma = {
      repository: {
        findFirst: vi.fn().mockResolvedValue(existingRepository),
        update: vi.fn().mockResolvedValue({
          ...existingRepository,
          url: 'https://git.example.com/new/flowx-web.git',
          localPath: null,
          syncStatus: 'PENDING',
          deployConfig: null,
        }),
      },
    };
    const repositorySyncService = {
      removeRepositoryStorage: vi.fn().mockResolvedValue(undefined),
      scheduleRepositorySync: vi.fn(),
    };

    return {
      prisma,
      repositorySyncService,
      service: new WorkspacesService(prisma as never, repositorySyncService as never),
    };
  }

  it('updates the repository URL and re-syncs from the new remote', async () => {
    const { prisma, repositorySyncService, service } = createService();

    await service.updateRepository('workspace-1', 'repo-1', {
      name: 'flowx-web',
      url: ' https://git.example.com/new/flowx-web.git ',
      defaultBranch: 'main',
    });

    expect(prisma.repository.update).toHaveBeenCalledWith({
      where: { id: 'repo-1' },
      data: {
        name: 'flowx-web',
        url: 'https://git.example.com/new/flowx-web.git',
        defaultBranch: 'main',
        localPath: null,
        syncStatus: 'PENDING',
        syncError: null,
      },
      include: { deployConfig: true },
    });
    expect(repositorySyncService.removeRepositoryStorage).toHaveBeenCalledWith(
      'workspace-1',
      'repo-1',
      'flowx-web',
    );
    expect(repositorySyncService.scheduleRepositorySync).toHaveBeenCalledTimes(1);
  });

  it('does not trigger a re-sync when the URL is unchanged', async () => {
    const { repositorySyncService, service } = createService();

    await service.updateRepository('workspace-1', 'repo-1', {
      name: 'flowx-web',
      url: existingRepository.url,
      defaultBranch: 'develop',
    });

    expect(repositorySyncService.removeRepositoryStorage).not.toHaveBeenCalled();
    expect(repositorySyncService.scheduleRepositorySync).not.toHaveBeenCalled();
  });
});
