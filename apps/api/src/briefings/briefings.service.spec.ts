import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingsService } from './briefings.service';

describe('BriefingsService', () => {
  const projectFindUnique = vi.fn();
  const configFindUnique = vi.fn();
  const configUpsert = vi.fn();
  const sourceFindMany = vi.fn();
  const eventFindMany = vi.fn();
  const briefingFindFirst = vi.fn();
  const briefingFindUnique = vi.fn();
  const briefingCreate = vi.fn();
  const briefingUpdate = vi.fn();
  const sendBriefing = vi.fn();
  const summarize = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    summarize.mockResolvedValue({
      source: 'fallback',
      headline: '测试摘要',
      summaryParagraph: '规则归纳。',
      features: [],
      fixes: [],
      risks: [],
      otherNotes: [],
    });
  });

  function createService() {
    return new BriefingsService(
      {
        project: { findUnique: projectFindUnique },
        projectBriefingConfig: {
          findUnique: configFindUnique,
          upsert: configUpsert,
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

  it('returns default project config when no config exists', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1' });
    configFindUnique.mockResolvedValue(null);

    await expect(createService().getProjectConfig('project-1')).resolves.toEqual({
      projectId: 'project-1',
      enabled: false,
      dailyHour: 18,
      timezone: 'Asia/Shanghai',
      autoSend: false,
      createdAt: null,
      updatedAt: null,
    });
  });

  it('rejects config lookups for missing projects', async () => {
    projectFindUnique.mockResolvedValue(null);

    await expect(createService().getProjectConfig('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('upserts project config', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1' });
    configUpsert.mockResolvedValue({ id: 'config-1', enabled: true });

    await expect(
      createService().upsertProjectConfig('project-1', {
        enabled: true,
        dailyHour: 9,
        timezone: 'Asia/Shanghai',
        autoSend: true,
      }),
    ).resolves.toEqual({ id: 'config-1', enabled: true });

    expect(configUpsert).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      create: {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 9,
        timezone: 'Asia/Shanghai',
        autoSend: true,
      },
      update: {
        enabled: true,
        dailyHour: 9,
        timezone: 'Asia/Shanghai',
        autoSend: true,
      },
    });
  });

  it('generates a project briefing from enabled workspace sources', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: {
        repositories: [{ id: 'repo-1' }],
      },
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
      createService().generateProjectBriefing('project-1', {
        date: '2026-06-03',
      }),
    ).resolves.toEqual({ id: 'briefing-1' });

    expect(eventFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        briefingSourceId: { in: ['source-1'] },
      },
      orderBy: { occurredAt: 'asc' },
    });
    expect(briefingCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        scopeKey: expect.stringContaining('source-1'),
        eventCount: 1,
      },
    });
  });

  it('updates an existing briefing when regenerate is true', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: { repositories: [{ id: 'repo-1' }] },
    });
    sourceFindMany.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    briefingFindFirst.mockResolvedValue({ id: 'existing-briefing' });
    eventFindMany.mockResolvedValue([]);
    briefingUpdate.mockResolvedValue({ id: 'existing-briefing', markdownContent: '# 研发日报' });

    await expect(
      createService().generateProjectBriefing('project-1', {
        date: '2026-06-03',
        regenerate: true,
      }),
    ).resolves.toEqual({ id: 'existing-briefing', markdownContent: '# 研发日报' });

    expect(briefingUpdate).toHaveBeenCalledWith({
      where: { id: 'existing-briefing' },
      data: expect.objectContaining({
        markdownContent: expect.stringContaining('# 研发日报'),
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
    sourceFindMany.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    briefingFindFirst.mockResolvedValue({ id: 'existing-briefing' });

    await expect(
      createService().generateProjectBriefing('project-1', {
        date: '2026-06-03',
      }),
    ).resolves.toEqual({ id: 'existing-briefing' });
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(briefingCreate).not.toHaveBeenCalled();
  });

  it('delegates resend to delivery targets service', async () => {
    briefingFindUnique.mockResolvedValue({ id: 'briefing-1', workspaceId: 'workspace-1' });
    sendBriefing.mockResolvedValue({ successCount: 1, targetCount: 1 });

    await expect(createService().sendBriefing('briefing-1')).resolves.toEqual({
      successCount: 1,
      targetCount: 1,
    });
  });
});

