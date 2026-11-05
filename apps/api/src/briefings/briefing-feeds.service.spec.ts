import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingFeedsService } from './briefing-feeds.service';

describe('BriefingFeedsService', () => {
  const projectFindUnique = vi.fn();
  const feedFindMany = vi.fn();
  const feedFindFirst = vi.fn();
  const feedFindUnique = vi.fn();
  const feedCreate = vi.fn();
  const feedUpdate = vi.fn();
  const feedDelete = vi.fn();
  const repositoryFindMany = vi.fn();
  const repositoryDeleteMany = vi.fn();
  const repositoryCreateMany = vi.fn();
  const targetFindMany = vi.fn();
  const targetDeleteMany = vi.fn();
  const targetCreateMany = vi.fn();
  const briefingCount = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new BriefingFeedsService({
      project: { findUnique: projectFindUnique },
      briefingFeed: {
        findMany: feedFindMany,
        findFirst: feedFindFirst,
        findUnique: feedFindUnique,
        create: feedCreate,
        update: feedUpdate,
        delete: feedDelete,
      },
      repository: { findMany: repositoryFindMany },
      briefingFeedRepository: {
        deleteMany: repositoryDeleteMany,
        createMany: repositoryCreateMany,
      },
      deliveryTarget: { findMany: targetFindMany },
      briefingFeedDeliveryTarget: {
        deleteMany: targetDeleteMany,
        createMany: targetCreateMany,
      },
      briefing: { count: briefingCount },
    } as never);
  }

  function feedRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'feed-1',
      projectId: 'project-1',
      name: '前端',
      enabled: false,
      dailyHour: 22,
      timezone: 'Asia/Shanghai',
      autoSend: false,
      lastSchedulerSlot: null,
      lastSchedulerRunAt: null,
      lastSchedulerMessage: null,
      repositories: [{ repositoryId: 'repo-1' }],
      deliveryTargets: [{ deliveryTargetId: 'target-1' }],
      createdAt: new Date('2026-11-05T00:00:00.000Z'),
      updatedAt: new Date('2026-11-05T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('creates a second feed and defaults to active briefing targets', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'workspace-1' });
    feedFindFirst.mockResolvedValue(null);
    repositoryFindMany.mockResolvedValue([{ id: 'repo-1' }, { id: 'repo-2' }]);
    targetFindMany.mockResolvedValue([{ id: 'target-1' }]);
    feedCreate.mockResolvedValue(feedRecord());

    await expect(createService().createFeed('project-1', {
      name: ' 前端 ',
      repositoryIds: ['repo-2', 'repo-1', 'repo-1'],
    })).resolves.toMatchObject({
      name: '前端',
      repositoryIds: ['repo-1'],
      deliveryTargetIds: ['target-1'],
    });

    expect(feedCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: 'project-1',
        name: '前端',
        repositories: { create: [{ repositoryId: 'repo-2' }, { repositoryId: 'repo-1' }] },
        deliveryTargets: { create: [{ deliveryTargetId: 'target-1' }] },
      }),
    }));
    expect(targetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'project-1', isActive: true, forBriefing: true },
    }));
  });

  it('rejects a duplicate name and a repository outside the workspace', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'workspace-1' });
    feedFindFirst.mockResolvedValue({ id: 'feed-existing' });

    await expect(createService().createFeed('project-1', { name: '前端' })).rejects.toBeInstanceOf(
      ConflictException,
    );

    feedFindFirst.mockResolvedValue(null);
    repositoryFindMany.mockResolvedValue([{ id: 'repo-1' }]);
    await expect(createService().createFeed('project-1', {
      name: '后端',
      repositoryIds: ['repo-1', 'repo-other'],
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps an explicit empty delivery selection', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'workspace-1' });
    feedFindFirst.mockResolvedValue(null);
    feedCreate.mockResolvedValue(feedRecord({ deliveryTargets: [] }));

    await createService().createFeed('project-1', {
      name: '前端',
      deliveryTargetIds: [],
    });

    expect(targetFindMany).not.toHaveBeenCalled();
    expect(feedCreate.mock.calls[0]?.[0].data.deliveryTargets).toEqual({ create: [] });
  });

  it('refuses to delete a feed that already has briefings', async () => {
    feedFindUnique.mockResolvedValue(feedRecord());
    briefingCount.mockResolvedValue(1);

    await expect(createService().deleteFeed('feed-1')).rejects.toBeInstanceOf(ConflictException);
    expect(feedDelete).not.toHaveBeenCalled();
  });

  it('deletes a feed with no briefings', async () => {
    feedFindUnique.mockResolvedValue(feedRecord());
    briefingCount.mockResolvedValue(0);
    feedDelete.mockResolvedValue({ id: 'feed-1' });

    await expect(createService().deleteFeed('feed-1')).resolves.toEqual({ success: true });
    expect(feedDelete).toHaveBeenCalledWith({ where: { id: 'feed-1' } });
  });

  it('rejects a missing project', async () => {
    projectFindUnique.mockResolvedValue(null);
    await expect(createService().listFeeds('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
