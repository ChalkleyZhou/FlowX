import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeReviewFeedsService } from './code-review-feeds.service';

describe('CodeReviewFeedsService', () => {
  const projectFindUnique = vi.fn();
  const feedFindFirst = vi.fn();
  const feedFindUnique = vi.fn();
  const feedCreate = vi.fn();
  const feedDelete = vi.fn();
  const repositoryFindMany = vi.fn();
  const targetFindMany = vi.fn();
  const reviewCount = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new CodeReviewFeedsService({
      project: { findUnique: projectFindUnique },
      codeReviewFeed: {
        findMany: vi.fn(),
        findFirst: feedFindFirst,
        findUnique: feedFindUnique,
        create: feedCreate,
        update: vi.fn(),
        delete: feedDelete,
      },
      repository: { findMany: repositoryFindMany },
      codeReviewFeedRepository: { deleteMany: vi.fn(), createMany: vi.fn() },
      deliveryTarget: { findMany: targetFindMany },
      codeReviewFeedDeliveryTarget: { deleteMany: vi.fn(), createMany: vi.fn() },
      dailyCodeReview: { count: reviewCount },
    } as never);
  }

  function feedRecord() {
    return {
      id: 'feed-1',
      projectId: 'project-1',
      name: '后端',
      enabled: true,
      dailyHour: 22,
      timezone: 'Asia/Shanghai',
      autoSend: true,
      lastSchedulerSlot: null,
      lastSchedulerRunAt: null,
      lastSchedulerMessage: null,
      repositories: [{ repositoryId: 'repo-1' }],
      deliveryTargets: [{ deliveryTargetId: 'target-1' }],
      createdAt: new Date('2026-11-05T00:00:00.000Z'),
      updatedAt: new Date('2026-11-05T00:00:00.000Z'),
    };
  }

  it('creates another code review and defaults to active code review targets', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'workspace-1' });
    feedFindFirst.mockResolvedValue(null);
    repositoryFindMany.mockResolvedValue([{ id: 'repo-1' }]);
    targetFindMany.mockResolvedValue([{ id: 'target-1' }]);
    feedCreate.mockResolvedValue(feedRecord());

    await expect(createService().createFeed('project-1', {
      name: '后端',
      enabled: true,
      repositoryIds: ['repo-1'],
    })).resolves.toMatchObject({
      name: '后端',
      repositoryIds: ['repo-1'],
      deliveryTargetIds: ['target-1'],
    });

    expect(targetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'project-1', isActive: true, forCodeReview: true },
    }));
  });

  it('rejects a duplicate name and a repository outside the workspace', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'workspace-1' });
    feedFindFirst.mockResolvedValue({ id: 'existing' });
    await expect(createService().createFeed('project-1', { name: '后端' })).rejects.toBeInstanceOf(
      ConflictException,
    );

    feedFindFirst.mockResolvedValue(null);
    repositoryFindMany.mockResolvedValue([]);
    await expect(createService().createFeed('project-1', {
      name: '前端',
      repositoryIds: ['repo-other'],
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to delete a feed that already has reviews and allows a new one', async () => {
    feedFindUnique.mockResolvedValue(feedRecord());
    reviewCount.mockResolvedValue(2);
    await expect(createService().deleteFeed('feed-1')).rejects.toBeInstanceOf(ConflictException);
    expect(feedDelete).not.toHaveBeenCalled();

    reviewCount.mockResolvedValue(0);
    feedDelete.mockResolvedValue({ id: 'feed-1' });
    await expect(createService().deleteFeed('feed-1')).resolves.toEqual({ success: true });
  });
});
