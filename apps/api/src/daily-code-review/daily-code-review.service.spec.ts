import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyCodeReviewService } from './daily-code-review.service';

describe('DailyCodeReviewService', () => {
  const findUniqueProject = vi.fn();
  const findUniqueConfig = vi.fn();
  const findFirstReview = vi.fn();
  const findManySources = vi.fn();
  const findManyEvents = vi.fn();
  const findManyCodeReviewSources = vi.fn();
  const createReview = vi.fn();
  const updateReview = vi.fn();
  const reviewUnit = vi.fn();
  const sendDailyCodeReview = vi.fn();
  const ensureCodeReviewSandbox = vi.fn();
  const ensureRepositoryReadyForReview = vi.fn();
  const buildCommitDiffBundle = vi.fn();
  const collectRecentCommits = vi.fn();
  const collectRecentCommitsFromLocalPath = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_EXECUTOR_PROVIDER = 'mock';
    buildCommitDiffBundle.mockResolvedValue('diff --git a/file.ts b/file.ts\n+change');
    collectRecentCommits.mockResolvedValue([]);
    collectRecentCommitsFromLocalPath.mockResolvedValue([]);
    findManyCodeReviewSources.mockResolvedValue([]);
    ensureCodeReviewSandbox.mockImplementation(async (repository, branch) => ({
      localPath: `/tmp/code-review/${repository.name}`,
      branch,
      syncStatus: 'READY' as const,
    }));
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
        codeReviewSource: { findMany: findManyCodeReviewSources },
      } as never,
      { reviewUnit } as never,
      { sendDailyCodeReview } as never,
      {
        ensureCodeReviewSandbox,
        ensureRepositoryReadyForReview,
        buildCommitDiffBundle,
        collectRecentCommits,
        collectRecentCommitsFromLocalPath,
      } as never,
    );
  }

  it('reviews each included repo via code-review sandbox paths', async () => {
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
    findManyCodeReviewSources.mockResolvedValue([]);
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

    expect(ensureCodeReviewSandbox).toHaveBeenCalledTimes(1);
    expect(ensureCodeReviewSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1', workspaceId: 'workspace-1', name: 'flowx-api' }),
      'main',
    );
    expect(collectRecentCommits).not.toHaveBeenCalled();
    expect(collectRecentCommitsFromLocalPath).not.toHaveBeenCalled();
    expect(ensureRepositoryReadyForReview).not.toHaveBeenCalled();
    expect(buildCommitDiffBundle).toHaveBeenCalledWith('/tmp/code-review/flowx-api', expect.any(Array));
    expect(reviewUnit).toHaveBeenCalledTimes(1);
    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          localPath: '/tmp/code-review/flowx-api',
          ref: 'main',
          commitDiffBundle: expect.stringContaining('diff --git'),
          commits: expect.arrayContaining([
            expect.objectContaining({ id: 'abc111' }),
            expect.objectContaining({ id: 'def111' }),
          ]),
        }),
      }),
    );
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          unitsJson: [
            expect.objectContaining({
              repositoryId: 'repo-1',
              ref: 'main',
              status: 'COMPLETED',
            }),
          ],
        }),
      }),
    );
  });

  it('still reviews an included repo when it has zero commits', async () => {
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
            currentBranch: 'develop',
            localPath: '/tmp/flowx-api',
            syncStatus: 'READY',
          },
        ],
      },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
    findFirstReview.mockResolvedValue(null);
    findManyCodeReviewSources.mockResolvedValue([]);
    findManySources.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    findManyEvents.mockResolvedValue([]);
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

    expect(ensureCodeReviewSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1' }),
      'develop',
    );
    expect(collectRecentCommits).not.toHaveBeenCalled();
    expect(collectRecentCommitsFromLocalPath).toHaveBeenCalledWith(
      '/tmp/code-review/flowx-api',
      expect.objectContaining({
        branch: 'develop',
        since: expect.any(Date),
        until: expect.any(Date),
      }),
    );
    expect(ensureRepositoryReadyForReview).not.toHaveBeenCalled();
    expect(reviewUnit).toHaveBeenCalledTimes(1);
    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          repositoryId: 'repo-1',
          localPath: '/tmp/code-review/flowx-api',
          ref: 'develop',
          commits: [],
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

  it('uses sandbox localPath even when workspace repository localPath is missing', async () => {
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
    findManyCodeReviewSources.mockResolvedValue([]);
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

    expect(ensureCodeReviewSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1', name: 'flowx-api' }),
      'main',
    );
    expect(ensureRepositoryReadyForReview).not.toHaveBeenCalled();
    expect(buildCommitDiffBundle).toHaveBeenCalledWith('/tmp/code-review/flowx-api', [
      { id: 'abc111', message: 'feat: one' },
    ]);
    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          localPath: '/tmp/code-review/flowx-api',
          ref: 'main',
          commitDiffBundle: expect.stringContaining('diff --git'),
        }),
      }),
    );
  });

  it('records sandbox sync failures as FAILED units', async () => {
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
    findManyCodeReviewSources.mockResolvedValue([]);
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
    ensureCodeReviewSandbox.mockResolvedValue({
      localPath: '/tmp/code-review/flowx-api',
      branch: 'main',
      syncStatus: 'ERROR',
      syncError: '代码库同步失败：auth required',
    });
    createReview.mockImplementation(async ({ data }) => ({
      id: 'review-1',
      ...data,
    }));

    await createService().generateProjectDailyCodeReview('project-1', {
      date: '2026-07-07',
      regenerate: true,
    });

    expect(ensureRepositoryReadyForReview).not.toHaveBeenCalled();
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
      findManyCodeReviewSources.mockResolvedValue([]);
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
    findManyCodeReviewSources.mockResolvedValue([]);
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

    expect(ensureCodeReviewSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-r2', name: 'R2CRM-Backend' }),
      'main',
    );
    expect(ensureRepositoryReadyForReview).not.toHaveBeenCalled();
    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          repositoryName: 'R2CRM-Backend',
          repositoryId: 'repo-r2',
          localPath: '/tmp/code-review/R2CRM-Backend',
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

  it('reviews every workspace repository by default, including BriefingSource-only and CR-only evidence paths', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [
          {
            id: 'repo-a',
            name: 'repo-a-briefing-only',
            url: 'https://example.com/repo-a.git',
            defaultBranch: 'main',
            currentBranch: 'main',
            localPath: '/tmp/repo-a',
            syncStatus: 'READY',
          },
          {
            id: 'repo-b',
            name: 'repo-b-cr-only',
            url: 'https://example.com/repo-b.git',
            defaultBranch: 'main',
            currentBranch: 'main',
            localPath: '/tmp/repo-b',
            syncStatus: 'READY',
          },
        ],
      },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
    findFirstReview.mockResolvedValue(null);
    // No exclusion rows → all workspace repos are in scope.
    findManyCodeReviewSources.mockResolvedValue([]);

    const briefingSources = [{ id: 'bs-a', repositoryId: 'repo-a' }];
    findManySources.mockImplementation(async ({ where }: { where: { repositoryId: { in: string[] } } }) =>
      briefingSources.filter((source) => where.repositoryId.in.includes(source.repositoryId)),
    );

    const briefingEvents = [
      {
        repositoryId: 'repo-a',
        briefingSourceId: 'bs-a',
        normalizedPayload: {
          eventType: 'push',
          projectName: 'repo-a-briefing-only',
          occurredAt: '2026-07-07T10:00:00.000Z',
          summary: { ref: 'main', commitCount: 1 },
          commits: [{ id: 'aaa111', message: 'feat: repo a change' }],
        },
        rawPayload: {},
      },
    ];
    findManyEvents.mockImplementation(
      async ({ where }: { where: { briefingSourceId: { in: string[] } } }) =>
        briefingEvents.filter((event) => where.briefingSourceId.in.includes(event.briefingSourceId)),
    );

    collectRecentCommitsFromLocalPath.mockImplementation(async (localPath: string) => {
      if (localPath !== '/tmp/code-review/repo-b-cr-only') {
        return [];
      }
      return [
        {
          id: 'bbb111',
          message: 'feat: repo b change from git log',
          author: 'dev',
          occurredAt: '2026-07-07T09:00:00.000Z',
        },
      ];
    });

    reviewUnit.mockResolvedValue({
      status: 'COMPLETED',
      issues: [],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    });
    createReview.mockImplementation(async ({ data }) => ({ id: 'review-1', ...data }));

    await createService().generateProjectDailyCodeReview('project-1', {
      date: '2026-07-07',
      regenerate: true,
    });

    expect(ensureCodeReviewSandbox).toHaveBeenCalledTimes(2);
    expect(ensureRepositoryReadyForReview).not.toHaveBeenCalled();
    expect(collectRecentCommits).not.toHaveBeenCalled();
    expect(collectRecentCommitsFromLocalPath).toHaveBeenCalledWith(
      '/tmp/code-review/repo-b-cr-only',
      expect.objectContaining({
        branch: 'main',
        since: expect.any(Date),
        until: expect.any(Date),
      }),
    );
    expect(collectRecentCommitsFromLocalPath).not.toHaveBeenCalledWith(
      '/tmp/code-review/repo-a-briefing-only',
      expect.anything(),
    );
    expect(reviewUnit).toHaveBeenCalledTimes(2);
    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          repositoryId: 'repo-a',
          localPath: '/tmp/code-review/repo-a-briefing-only',
        }),
      }),
    );
    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          repositoryId: 'repo-b',
          localPath: '/tmp/code-review/repo-b-cr-only',
          commits: [expect.objectContaining({ id: 'bbb111' })],
        }),
      }),
    );
  });

  it('excludes workspace repositories marked inactive on CodeReviewSource', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [
          {
            id: 'repo-a',
            name: 'repo-a',
            url: 'https://example.com/repo-a.git',
            defaultBranch: 'main',
            currentBranch: 'main',
            localPath: '/tmp/repo-a',
            syncStatus: 'READY',
          },
          {
            id: 'repo-b',
            name: 'repo-b',
            url: 'https://example.com/repo-b.git',
            defaultBranch: 'main',
            currentBranch: 'main',
            localPath: '/tmp/repo-b',
            syncStatus: 'READY',
          },
        ],
      },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
    findFirstReview.mockResolvedValue(null);
    findManyCodeReviewSources.mockResolvedValue([
      { id: 'cr-exclude-a', repositoryId: 'repo-a', isActive: false },
    ]);
    findManySources.mockResolvedValue([]);
    findManyEvents.mockResolvedValue([]);
    collectRecentCommitsFromLocalPath.mockResolvedValue([
      {
        id: 'bbb111',
        message: 'feat: repo b only',
        author: 'dev',
        occurredAt: '2026-07-07T09:00:00.000Z',
      },
    ]);
    reviewUnit.mockResolvedValue({
      status: 'COMPLETED',
      issues: [],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    });
    createReview.mockImplementation(async ({ data }) => ({ id: 'review-1', ...data }));

    await createService().generateProjectDailyCodeReview('project-1', {
      date: '2026-07-07',
      regenerate: true,
    });

    expect(findManyCodeReviewSources).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: false }),
      }),
    );
    expect(ensureCodeReviewSandbox).toHaveBeenCalledTimes(1);
    expect(ensureCodeReviewSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-b' }),
      'main',
    );
    expect(collectRecentCommits).not.toHaveBeenCalled();
    expect(collectRecentCommitsFromLocalPath).toHaveBeenCalledWith(
      '/tmp/code-review/repo-b',
      expect.objectContaining({ branch: 'main' }),
    );
    expect(ensureRepositoryReadyForReview).not.toHaveBeenCalled();
    expect(reviewUnit).toHaveBeenCalledTimes(1);
    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          repositoryId: 'repo-b',
          localPath: '/tmp/code-review/repo-b',
        }),
      }),
    );
  });

  it('records an empty-run when the workspace has no repositories', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [],
      },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
    findFirstReview.mockResolvedValue(null);
    findManyCodeReviewSources.mockResolvedValue([]);
    createReview.mockImplementation(async ({ data }) => ({ id: 'review-1', ...data }));

    await createService().generateProjectDailyCodeReview('project-1', {
      date: '2026-07-07',
      regenerate: true,
    });

    expect(findManySources).not.toHaveBeenCalled();
    expect(findManyEvents).not.toHaveBeenCalled();
    expect(reviewUnit).not.toHaveBeenCalled();
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SKIPPED_NO_CR_SOURCES',
          unitsJson: [],
          errorMessage: expect.stringContaining('尚未登记任何代码仓库'),
        }),
      }),
    );
    const created = createReview.mock.calls[0]?.[0].data;
    expect(created.markdownContent).not.toContain('今日无代码变更');
    expect(created.htmlContent).not.toContain('今日无代码变更');
  });

  it('still reviews a CR-only repository when optional git evidence collection fails', async () => {
    findUniqueProject.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [
          {
            id: 'repo-b',
            name: 'repo-b-cr-only',
            url: 'https://example.com/repo-b.git',
            defaultBranch: 'main',
            currentBranch: 'main',
            localPath: '/tmp/repo-b',
            syncStatus: 'READY',
          },
        ],
      },
    });
    findUniqueConfig.mockResolvedValue({ dailyHour: 22 });
    findFirstReview.mockResolvedValue(null);
    findManyCodeReviewSources.mockResolvedValue([]);
    findManySources.mockResolvedValue([]);
    findManyEvents.mockResolvedValue([]);
    collectRecentCommitsFromLocalPath.mockRejectedValue(new Error('git log failed'));
    reviewUnit.mockResolvedValue({
      status: 'COMPLETED',
      issues: [],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    });
    createReview.mockImplementation(async ({ data }) => ({ id: 'review-1', ...data }));

    await createService().generateProjectDailyCodeReview('project-1', {
      date: '2026-07-07',
      regenerate: true,
    });

    expect(ensureCodeReviewSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-b' }),
      'main',
    );
    expect(collectRecentCommits).not.toHaveBeenCalled();
    expect(collectRecentCommitsFromLocalPath).toHaveBeenCalled();
    expect(ensureRepositoryReadyForReview).not.toHaveBeenCalled();
    expect(reviewUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({
          repositoryId: 'repo-b',
          localPath: '/tmp/code-review/repo-b-cr-only',
          commits: [],
        }),
      }),
    );
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          unitsJson: [
            expect.objectContaining({
              repositoryId: 'repo-b',
              status: 'COMPLETED',
            }),
          ],
        }),
      }),
    );
  });
});
