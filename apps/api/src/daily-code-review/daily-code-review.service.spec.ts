import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyCodeReviewService } from './daily-code-review.service';

describe('DailyCodeReviewService', () => {
  const findUniqueProject = vi.fn();
  const findUniqueConfig = vi.fn();
  const findFirstReview = vi.fn();
  const findManySources = vi.fn();
  const findManyEvents = vi.fn();
  const createReview = vi.fn();
  const updateReview = vi.fn();
  const reviewUnit = vi.fn();
  const sendDailyCodeReview = vi.fn();
  const ensureRepositoryReadyForReview = vi.fn();
  const buildCommitDiffBundle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_EXECUTOR_PROVIDER = 'mock';
    buildCommitDiffBundle.mockResolvedValue('diff --git a/file.ts b/file.ts\n+change');
  });

  function createService() {
    return new DailyCodeReviewService(
      {
        project: { findUnique: findUniqueProject },
        projectCodeReviewConfig: { findUnique: findUniqueConfig },
        dailyCodeReview: {
          findFirst: findFirstReview,
          create: createReview,
          update: updateReview,
          findUnique: vi.fn(),
          findMany: vi.fn(),
        },
        briefingSource: { findMany: findManySources },
        briefingEvent: { findMany: findManyEvents },
      } as never,
      { reviewUnit } as never,
      { sendDailyCodeReview } as never,
      { ensureRepositoryReadyForReview, buildCommitDiffBundle } as never,
    );
  }

  it('groups commits by branch and stores unit results', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [
          {
            id: 'repo-1',
            name: 'flowx-api',
            url: 'https://example.com/flowx-api.git',
            defaultBranch: 'main',
            currentBranch: 'main',
            localPath: '/tmp/flowx-api',
            syncStatus: 'READY',
          },
        ],
      },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
    findFirstReview.mockResolvedValue(null);
    findManySources.mockResolvedValue([
      { id: 'source-1', repositoryId: 'repo-1' },
    ]);
    findManyEvents.mockResolvedValue([
      {
        repositoryId: 'repo-1',
        normalizedPayload: {
          eventType: 'push',
          projectName: 'flowx-api',
          occurredAt: '2026-07-07T10:00:00.000Z',
          summary: { ref: 'main', commitCount: 2 },
          commits: [
            { id: 'abc111', message: 'feat: one' },
            { id: 'abc222', message: 'fix: two' },
          ],
        },
        rawPayload: {},
      },
      {
        repositoryId: 'repo-1',
        normalizedPayload: {
          eventType: 'push',
          projectName: 'flowx-api',
          occurredAt: '2026-07-07T11:00:00.000Z',
          summary: { ref: 'feature/login', commitCount: 1 },
          commits: [{ id: 'def111', message: 'feat: login' }],
        },
        rawPayload: {},
      },
    ]);
    ensureRepositoryReadyForReview.mockImplementation(async (repository, branch) => ({
      ...repository,
      localPath: `/tmp/${repository.name}`,
      currentBranch: branch === 'unknown' ? 'main' : branch,
      syncStatus: 'READY',
    }));
    reviewUnit.mockResolvedValue({
      status: 'COMPLETED',
      issues: ['issue'],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    });
    createReview.mockImplementation(async ({ data }) => ({
      id: 'review-1',
      ...data,
    }));

    await createService().generateProjectDailyCodeReview('project-1', {
      date: '2026-07-07',
      regenerate: true,
    });

    expect(ensureRepositoryReadyForReview).toHaveBeenCalledTimes(2);
    expect(ensureRepositoryReadyForReview.mock.calls[0]?.[1]).toBe('feature/login');
    expect(ensureRepositoryReadyForReview.mock.calls[0]?.[2]).toEqual(['def111']);
    expect(ensureRepositoryReadyForReview.mock.calls[1]?.[1]).toBe('main');
    expect(ensureRepositoryReadyForReview.mock.calls[1]?.[2]).toEqual(['abc111', 'abc222']);
    expect(buildCommitDiffBundle).toHaveBeenCalledTimes(2);
    expect(reviewUnit).toHaveBeenCalledTimes(2);
    expect(reviewUnit.mock.calls[0]?.[0].unit.ref).toBe('feature/login');
    expect(reviewUnit.mock.calls[0]?.[0].unit.commitDiffBundle).toContain('diff --git');
    expect(reviewUnit.mock.calls[1]?.[0].unit.ref).toBe('main');
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          unitsJson: expect.arrayContaining([
            expect.objectContaining({ ref: 'feature/login' }),
            expect.objectContaining({ ref: 'main', commits: expect.any(Array) }),
          ]),
        }),
      }),
    );
  });

  it('uses ProjectCodeReviewConfig.dailyHour for the cutoff window', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: { id: 'workspace-1', name: '研发平台', repositories: [] },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 9 });
    findFirstReview.mockResolvedValue(null);
    findManySources.mockResolvedValue([]);
    findManyEvents.mockResolvedValue([]);
    createReview.mockImplementation(async ({ data }) => ({ id: 'review-1', ...data }));

    await createService().generateProjectDailyCodeReview('project-1', { date: '2026-07-07' });

    expect(findUniqueConfig).toHaveBeenCalledWith({ where: { projectId: 'project-1' } });
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope: expect.objectContaining({ cutoffHour: 9 }),
        }),
      }),
    );
  });

  it('falls back to the default daily hour when ProjectCodeReviewConfig is missing', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: { id: 'workspace-1', name: '研发平台', repositories: [] },
    });
    findUniqueConfig.mockResolvedValue(null);
    findFirstReview.mockResolvedValue(null);
    findManySources.mockResolvedValue([]);
    findManyEvents.mockResolvedValue([]);
    createReview.mockImplementation(async ({ data }) => ({ id: 'review-1', ...data }));

    await createService().generateProjectDailyCodeReview('project-1', { date: '2026-07-07' });

    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope: expect.objectContaining({ cutoffHour: 22 }),
        }),
      }),
    );
  });

  it('syncs repositories before review when local path is missing', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [
          {
            id: 'repo-1',
            name: 'flowx-api',
            url: 'https://example.com/flowx-api.git',
            defaultBranch: 'main',
            currentBranch: 'main',
            localPath: null,
            syncStatus: 'PENDING',
          },
        ],
      },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
    findFirstReview.mockResolvedValue(null);
    findManySources.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    findManyEvents.mockResolvedValue([
      {
        repositoryId: 'repo-1',
        normalizedPayload: {
          eventType: 'push',
          projectName: 'flowx-api',
          occurredAt: '2026-07-07T10:00:00.000Z',
          summary: { ref: 'feature/login', commitCount: 1 },
          commits: [{ id: 'abc111', message: 'feat: one' }],
        },
        rawPayload: {},
      },
    ]);
    ensureRepositoryReadyForReview.mockResolvedValue({
      id: 'repo-1',
      name: 'flowx-api',
      url: 'https://example.com/flowx-api.git',
      defaultBranch: 'main',
      currentBranch: 'feature/login',
      localPath: '/tmp/flowx-api',
      syncStatus: 'READY',
    });
    reviewUnit.mockResolvedValue({
      status: 'COMPLETED',
      issues: [],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    });
    createReview.mockImplementation(async ({ data }) => ({
      id: 'review-1',
      ...data,
    }));

    await createService().generateProjectDailyCodeReview('project-1', {
      date: '2026-07-07',
      regenerate: true,
    });

    expect(ensureRepositoryReadyForReview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1', localPath: null }),
      'feature/login',
      ['abc111'],
    );
    expect(buildCommitDiffBundle).toHaveBeenCalledWith('/tmp/flowx-api', [
      { id: 'abc111', message: 'feat: one' },
    ]);
    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          localPath: '/tmp/flowx-api',
          ref: 'feature/login',
          commitDiffBundle: expect.stringContaining('diff --git'),
        }),
      }),
    );
  });

  it('records sync failures as FAILED units', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [
          {
            id: 'repo-1',
            name: 'flowx-api',
            url: 'https://example.com/flowx-api.git',
            defaultBranch: 'main',
            currentBranch: 'main',
            localPath: null,
            syncStatus: 'PENDING',
          },
        ],
      },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
    findFirstReview.mockResolvedValue(null);
    findManySources.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    findManyEvents.mockResolvedValue([
      {
        repositoryId: 'repo-1',
        normalizedPayload: {
          eventType: 'push',
          projectName: 'flowx-api',
          occurredAt: '2026-07-07T10:00:00.000Z',
          summary: { ref: 'main', commitCount: 1 },
          commits: [{ id: 'abc111', message: 'feat: one' }],
        },
        rawPayload: {},
      },
    ]);
    ensureRepositoryReadyForReview.mockRejectedValue(new Error('代码库同步失败：auth required'));
    createReview.mockImplementation(async ({ data }) => ({
      id: 'review-1',
      ...data,
    }));

    await createService().generateProjectDailyCodeReview('project-1', {
      date: '2026-07-07',
      regenerate: true,
    });

    expect(reviewUnit).not.toHaveBeenCalled();
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitsJson: [
            expect.objectContaining({
              status: 'FAILED',
              errorMessage: '代码库同步失败：auth required',
            }),
          ],
        }),
      }),
    );
  });

  it('starts manual code review generation asynchronously without waiting for AI review', async () => {
    vi.useFakeTimers();
    try {
      findUniqueProject.mockResolvedValue({
        id: 'project-1',
        name: 'FlowX',
        workspaceId: 'workspace-1',
        workspace: {
          id: 'workspace-1',
          name: '研发平台',
          repositories: [
            {
              id: 'repo-1',
              name: 'flowx-api',
              url: 'https://example.com/flowx-api.git',
              defaultBranch: 'main',
              currentBranch: 'main',
              localPath: '/tmp/flowx-api',
              syncStatus: 'READY',
            },
          ],
        },
      });
      findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
      findFirstReview.mockResolvedValue(null);
      findManySources.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
      findManyEvents.mockResolvedValue([
        {
          repositoryId: 'repo-1',
          normalizedPayload: {
            eventType: 'push',
            projectName: 'flowx-api',
            occurredAt: '2026-07-07T10:00:00.000Z',
            summary: { ref: 'main', commitCount: 1 },
            commits: [{ id: 'abc111', message: 'feat: one' }],
          },
          rawPayload: {},
        },
      ]);
      reviewUnit.mockReturnValue(new Promise(() => undefined));
      createReview.mockResolvedValue({
        id: 'review-1',
        status: 'GENERATING',
        markdownContent: '# FlowX · 每日 Code Review · 2026-07-07',
      });

      await expect(
        createService().generateProjectDailyCodeReview(
          'project-1',
          { date: '2026-07-07', regenerate: true },
          undefined,
          { async: true },
        ),
      ).resolves.toMatchObject({
        id: 'review-1',
        status: 'GENERATING',
      });

      expect(createReview).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'GENERATING',
            generatedAt: null,
            errorMessage: null,
            sentAt: null,
          }),
        }),
      );
      expect(reviewUnit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves repositories by briefing event repositoryId when webhook projectName differs', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'R2CRM',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [
          {
            id: 'repo-r2',
            name: 'R2CRM-Backend',
            url: 'https://example.com/r2crm.git',
            defaultBranch: 'main',
            currentBranch: 'main',
            localPath: '/tmp/r2crm',
            syncStatus: 'READY',
          },
        ],
      },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
    findFirstReview.mockResolvedValue(null);
    findManySources.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-r2' }]);
    findManyEvents.mockResolvedValue([
      {
        repositoryId: 'repo-r2',
        normalizedPayload: {
          eventType: 'push',
          projectName: 'r2crm',
          occurredAt: '2026-07-07T10:00:00.000Z',
          summary: { ref: 'main', commitCount: 1 },
          commits: [{ id: 'abc111', message: 'feat: one' }],
        },
        rawPayload: {},
      },
    ]);
    ensureRepositoryReadyForReview.mockImplementation(async (repository, branch) => ({
      ...repository,
      localPath: '/tmp/r2crm',
      currentBranch: branch,
      syncStatus: 'READY',
    }));
    reviewUnit.mockResolvedValue({
      status: 'COMPLETED',
      issues: [],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    });
    createReview.mockImplementation(async ({ data }) => ({
      id: 'review-1',
      ...data,
    }));

    await createService().generateProjectDailyCodeReview('project-1', {
      date: '2026-07-07',
      regenerate: true,
    });

    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          repositoryName: 'R2CRM-Backend',
          repositoryId: 'repo-r2',
          ref: 'main',
        }),
      }),
    );
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitsJson: [
            expect.objectContaining({
              repositoryName: 'R2CRM-Backend',
              repositoryId: 'repo-r2',
              status: 'COMPLETED',
            }),
          ],
        }),
      }),
    );
  });
});
