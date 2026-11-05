import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingsService } from './briefings.service';

describe('BriefingsService', () => {
  const projectFindUnique = vi.fn();
  const configFindUnique = vi.fn();
  const sourceFindMany = vi.fn();
  const eventFindMany = vi.fn();
  const briefingFindFirst = vi.fn();
  const briefingFindUnique = vi.fn();
  const briefingCreate = vi.fn();
  const briefingUpdate = vi.fn();
  const sendBriefing = vi.fn();
  const summarize = vi.fn();
  let stagedProject: { id?: string; workspace?: { repositories?: Array<{ id: string }> } } | null = null;
  let stagedHour = 22;
  let stagedRepositoryIds: string[] | null = null;
  const resolveProject = projectFindUnique.mockResolvedValue.bind(projectFindUnique);
  const resolveConfig = configFindUnique.mockResolvedValue.bind(configFindUnique);

  beforeEach(() => {
    vi.clearAllMocks();
    stagedProject = null;
    stagedHour = 22;
    stagedRepositoryIds = null;
    projectFindUnique.mockResolvedValue = (value) => {
      stagedProject = value;
      return resolveProject(value);
    };
    configFindUnique.mockResolvedValue = (value) => {
      stagedHour = value && typeof value === 'object' && typeof value.dailyHour === 'number'
        ? value.dailyHour
        : 22;
      return resolveConfig(value);
    };
    summarize.mockResolvedValue({
      source: 'fallback',
      headline: '测试摘要',
      summaryParagraph: '规则归纳。',
      topics: [],
      openQuestions: [],
    });
  });

  function createService() {
    return new BriefingsService(
      {
        project: { findUnique: projectFindUnique },
        briefingFeed: {
          findUnique: vi.fn(async () => {
            if (!stagedProject) {
              return null;
            }
            const repositoryIds = stagedRepositoryIds
              ?? stagedProject.workspace?.repositories?.map((repository) => repository.id)
              ?? [];
            return {
              id: 'feed-1',
              dailyHour: stagedHour,
              repositories: repositoryIds.map((repositoryId) => ({ repositoryId })),
              project: stagedProject,
            };
          }),
        },
        briefingSource: { findMany: sourceFindMany },
        briefingEvent: { findMany: eventFindMany },
        briefing: {
          findFirst: briefingFindFirst,
          findUnique: briefingFindUnique,
          create: briefingCreate,
          update: briefingUpdate,
        },
      } as never,
      { sendBriefing } as never,
      { summarize } as never,
    );
  }

  it('generates a project briefing from enabled workspace sources', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        repositories: [{ id: 'repo-1' }],
      },
    });
    configFindUnique.mockResolvedValue({
      dailyHour: 22,
    });
    sourceFindMany.mockResolvedValue([
      {
        id: 'source-1',
        repositoryId: 'repo-1',
      },
    ]);
    briefingFindFirst.mockResolvedValue(null);
    eventFindMany.mockResolvedValue([
      {
        normalizedPayload: {
          provider: 'gitlab',
          externalPath: 'rokid/flowx',
          externalId: '42',
          eventType: 'push',
          objectKind: 'push',
          projectName: 'flowx',
          action: 'push',
          subject: 'main',
          occurredAt: '2026-06-03T01:00:00.000Z',
          summary: {},
        },
      },
    ]);
    briefingCreate.mockResolvedValue({ id: 'briefing-1' });

    await expect(
      createService().generateFeedBriefing('project-1', {
        date: '2026-06-03',
      }),
    ).resolves.toEqual({ id: 'briefing-1' });

    expect(eventFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        briefingSourceId: { in: ['source-1'] },
        occurredAt: {
          gte: new Date('2026-06-02T14:00:00.000Z'),
          lt: new Date('2026-06-03T14:00:00.000Z'),
        },
      },
      orderBy: { occurredAt: 'asc' },
    });
    expect(briefingCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        scopeKey: expect.stringContaining('source-1'),
        period: 'DAILY',
        periodStart: new Date('2026-06-02T14:00:00.000Z'),
        periodEnd: new Date('2026-06-03T14:00:00.000Z'),
        eventCount: 1,
      },
    });
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
      projectName: 'FlowX',
    }));
  });

  it('passes the authenticated organization context to the AI summarizer', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        repositories: [{ id: 'repo-1' }],
      },
    });
    configFindUnique.mockResolvedValue({ dailyHour: 22 });
    sourceFindMany.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    briefingFindFirst.mockResolvedValue(null);
    eventFindMany.mockResolvedValue([]);
    briefingCreate.mockResolvedValue({ id: 'briefing-1' });

    await createService().generateFeedBriefing(
      'project-1',
      { date: '2026-06-03' },
      {
        user: { id: 'user-1', displayName: '张三' },
        organization: {
          id: 'org-1',
          name: '研发组织',
          providerOrganizationId: 'corp-1',
        },
      },
    );

    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      recipient: {
        flowxUserId: 'user-1',
        flowxOrganizationId: 'org-1',
        displayName: '张三',
        providerOrganizationId: 'corp-1',
        organizationName: '研发组织',
      },
    }));
  });

  it('starts manual briefing generation asynchronously without waiting for AI summary', async () => {
    vi.useFakeTimers();
    try {
      projectFindUnique.mockResolvedValue({
        id: 'project-1',
        name: 'FlowX',
        workspaceId: 'workspace-1',
        workspace: {
          repositories: [{ id: 'repo-1' }],
        },
      });
      configFindUnique.mockResolvedValue({ dailyHour: 22 });
      sourceFindMany.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
      briefingFindFirst.mockResolvedValue(null);
      eventFindMany.mockResolvedValue([]);
      summarize.mockResolvedValue(new Promise(() => undefined));
      briefingCreate.mockResolvedValue({
        id: 'briefing-1',
        status: 'GENERATING',
        markdownContent: '# FlowX · 项目变化周报 · 2026-06-15 至 2026-06-21',
      });

      await expect(
        createService().generateFeedBriefing(
          'project-1',
          { period: 'WEEKLY', date: '2026-06-17', regenerate: true },
          {
            user: { id: 'user-1', displayName: '张三' },
            organization: { id: 'org-1', name: '研发组织' },
          },
          { async: true },
        ),
      ).resolves.toMatchObject({
        id: 'briefing-1',
        status: 'GENERATING',
      });

      expect(briefingCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'GENERATING',
          generatedAt: null,
          errorMessage: null,
          sentAt: null,
        }),
      }));
      expect(summarize).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('generates a weekly project briefing from natural week events', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: { repositories: [{ id: 'repo-1' }] },
    });
    configFindUnique.mockResolvedValue({ dailyHour: 22 });
    sourceFindMany.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    briefingFindFirst.mockResolvedValue(null);
    eventFindMany.mockResolvedValue([]);
    briefingCreate.mockResolvedValue({ id: 'weekly-briefing' });

    await expect(
      createService().generateFeedBriefing('project-1', {
        period: 'WEEKLY',
        date: '2026-06-17',
      }),
    ).resolves.toEqual({ id: 'weekly-briefing' });

    expect(eventFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        briefingSourceId: { in: ['source-1'] },
        occurredAt: {
          gte: new Date('2026-06-14T16:00:00.000Z'),
          lt: new Date('2026-06-21T16:00:00.000Z'),
        },
      },
      orderBy: { occurredAt: 'asc' },
    });
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      period: 'WEEKLY',
      date: '2026-06-15',
      rangeLabel: '2026-06-15 至 2026-06-21',
      projectName: 'FlowX',
    }));
    expect(briefingCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        date: new Date('2026-06-14T16:00:00.000Z'),
        period: 'WEEKLY',
        periodStart: new Date('2026-06-14T16:00:00.000Z'),
        periodEnd: new Date('2026-06-21T16:00:00.000Z'),
        eventCount: 0,
      },
    });
    expect(briefingCreate.mock.calls[0]?.[0].data.scopeKey).toContain('"period":"WEEKLY"');
  });

  it('updates an existing briefing when regenerate is true', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: { repositories: [{ id: 'repo-1' }] },
    });
    configFindUnique.mockResolvedValue(null);
    sourceFindMany.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    briefingFindFirst.mockResolvedValue({ id: 'existing-briefing' });
    eventFindMany.mockResolvedValue([]);
    briefingUpdate.mockResolvedValue({
      id: 'existing-briefing',
      markdownContent: '# FlowX · 项目变化简报 · 2026-06-03',
    });

    await expect(
      createService().generateFeedBriefing('project-1', {
        date: '2026-06-03',
        regenerate: true,
      }),
    ).resolves.toEqual({
      id: 'existing-briefing',
      markdownContent: '# FlowX · 项目变化简报 · 2026-06-03',
    });

    expect(briefingUpdate).toHaveBeenCalledWith({
      where: { id: 'existing-briefing' },
      data: expect.objectContaining({
        markdownContent: expect.stringContaining('# FlowX · 项目变化简报 · 2026-06-03'),
        sentAt: null,
      }),
    });
    expect(briefingCreate).not.toHaveBeenCalled();
  });

  it('returns an existing briefing unless regenerate is true', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      workspaceId: 'workspace-1',
      workspace: { repositories: [{ id: 'repo-1' }] },
    });
    configFindUnique.mockResolvedValue(null);
    sourceFindMany.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    briefingFindFirst.mockResolvedValue({ id: 'existing-briefing' });

    await expect(
      createService().generateFeedBriefing('project-1', {
        date: '2026-06-03',
      }),
    ).resolves.toEqual({ id: 'existing-briefing' });
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(briefingCreate).not.toHaveBeenCalled();
  });

  it('delegates resend to delivery targets service with project title context', async () => {
    briefingFindUnique.mockResolvedValue({
      id: 'briefing-1',
      projectId: 'project-1',
      project: { name: 'FlowX' },
      feed: { deliveryTargets: [{ deliveryTargetId: 'target-1' }] },
      date: new Date('2026-06-03T00:00:00.000Z'),
      markdownContent: '# FlowX · 研发日报 · 2026-06-03',
      htmlContent: '<h1>FlowX · 研发日报 · 2026-06-03</h1>',
    });
    sendBriefing.mockResolvedValue({ successCount: 1, targetCount: 1 });

    await expect(createService().sendBriefing('briefing-1')).resolves.toEqual({
      successCount: 1,
      targetCount: 1,
    });

    expect(sendBriefing).toHaveBeenCalledWith({
      id: 'briefing-1',
      projectId: 'project-1',
      projectName: 'FlowX',
      date: new Date('2026-06-03T00:00:00.000Z'),
      markdownContent: '# FlowX · 研发日报 · 2026-06-03',
      htmlContent: '<h1>FlowX · 研发日报 · 2026-06-03</h1>',
      deliveryTargetIds: ['target-1'],
    });
  });

  it('aggregates events only from repositories selected on the feed', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: { repositories: [{ id: 'repo-1' }, { id: 'repo-2' }] },
    });
    configFindUnique.mockResolvedValue({ dailyHour: 22 });
    stagedRepositoryIds = ['repo-1'];
    sourceFindMany.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    briefingFindFirst.mockResolvedValue(null);
    eventFindMany.mockResolvedValue([]);
    briefingCreate.mockResolvedValue({ id: 'briefing-1' });

    await createService().generateFeedBriefing('feed-1', { date: '2026-06-03' });

    expect(sourceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        repositoryId: { in: ['repo-1'] },
      }),
    }));
    expect(briefingFindFirst).toHaveBeenCalledWith({
      where: {
        feedId: 'feed-1',
        date: new Date('2026-06-02T16:00:00.000Z'),
        period: 'DAILY',
      },
    });
  });

  it('stores an empty briefing when the feed has no repositories', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: { repositories: [{ id: 'repo-1' }] },
    });
    configFindUnique.mockResolvedValue({ dailyHour: 22 });
    stagedRepositoryIds = [];
    briefingFindFirst.mockResolvedValue(null);
    briefingCreate.mockResolvedValue({ id: 'briefing-empty' });

    await createService().generateFeedBriefing('feed-1', { date: '2026-06-03' });

    expect(sourceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ repositoryId: { in: [] } }),
    }));
    expect(briefingCreate.mock.calls[0]?.[0].data.eventCount).toBe(0);
    expect(briefingCreate.mock.calls[0]?.[0].data.feedId).toBe('feed-1');
  });
});
