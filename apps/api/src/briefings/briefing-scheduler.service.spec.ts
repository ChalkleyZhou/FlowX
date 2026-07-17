import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingSchedulerService } from './briefing-scheduler.service';

vi.mock('./briefing-auth-session', () => ({
  resolveProjectOrganizationId: vi.fn(),
  buildSchedulerAuthSession: vi.fn(),
}));

import {
  buildSchedulerAuthSession,
  resolveProjectOrganizationId,
} from './briefing-auth-session';

describe('BriefingSchedulerService', () => {
  const configFindMany = vi.fn();
  const configUpdateMany = vi.fn();
  const configUpdate = vi.fn();
  const generateProjectBriefing = vi.fn();
  const sendBriefing = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    configUpdateMany.mockResolvedValue({ count: 0 });
    configUpdate.mockResolvedValue({});
    vi.mocked(resolveProjectOrganizationId).mockResolvedValue('org-1');
    vi.mocked(buildSchedulerAuthSession).mockResolvedValue({
      organization: { id: 'org-1', name: '研发组织' },
    });
  });

  afterEach(() => {
    delete process.env.FLOWX_BRIEFING_SCHEDULER_DISABLED;
  });

  function createService() {
    return new BriefingSchedulerService(
      {
        projectBriefingConfig: {
          findMany: configFindMany,
          updateMany: configUpdateMany,
          update: configUpdate,
        },
      } as never,
      {
        generateProjectBriefing,
        sendBriefing,
      } as never,
    );
  }

  it('generates and sends due project briefings', async () => {
    configFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 18,
        lastSchedulerSlot: null,
        project: { id: 'project-1', name: 'FlowX' },
      },
    ]);
    generateProjectBriefing.mockResolvedValue({ id: 'briefing-1', sentAt: null });
    sendBriefing.mockResolvedValue({ successCount: 1, targetCount: 1 });

    await expect(
      createService().runDueBriefings(new Date('2026-06-03T10:00:00.000Z')),
    ).resolves.toEqual({ generatedCount: 1 });

    expect(generateProjectBriefing).toHaveBeenCalledWith(
      'project-1',
      {
        date: '2026-06-03',
        regenerate: true,
      },
      {
        organization: { id: 'org-1', name: '研发组织' },
      },
    );
    expect(sendBriefing).toHaveBeenCalledWith('briefing-1');
    expect(configUpdate).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: expect.objectContaining({
        lastSchedulerSlot: '2026-06-03@18',
      }),
    });
  });

  it('skips configs that are not due yet', async () => {
    configFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 17,
        lastSchedulerSlot: null,
        project: { id: 'project-1', name: 'FlowX' },
      },
    ]);

    await expect(
      createService().runDueBriefings(new Date('2026-06-03T10:00:00.000Z')),
    ).resolves.toEqual({ generatedCount: 0 });

    expect(generateProjectBriefing).not.toHaveBeenCalled();
  });

  it('skips a scheduler slot that already completed', async () => {
    configFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 18,
        lastSchedulerSlot: '2026-06-03@18',
        project: { id: 'project-1', name: 'FlowX' },
      },
    ]);

    await expect(
      createService().runDueBriefings(new Date('2026-06-03T10:00:00.000Z')),
    ).resolves.toEqual({ generatedCount: 0 });

    expect(generateProjectBriefing).not.toHaveBeenCalled();
  });

  it('records a delivery failure without locking the slot', async () => {
    configFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 18,
        lastSchedulerSlot: null,
        project: { id: 'project-1', name: 'FlowX' },
      },
    ]);
    generateProjectBriefing.mockResolvedValue({ id: 'briefing-1', sentAt: null });
    sendBriefing.mockResolvedValue({ successCount: 0, targetCount: 0 });

    await createService().runDueBriefings(new Date('2026-06-03T10:00:00.000Z'));

    expect(configUpdate).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: expect.objectContaining({
        lastSchedulerMessage: expect.stringContaining('未配置启用的投递目标'),
      }),
    });
    expect(configUpdate.mock.calls[0]?.[0].data.lastSchedulerSlot).toBeUndefined();
  });

  it('does not run when FLOWX_BRIEFING_SCHEDULER_DISABLED is true', () => {
    process.env.FLOWX_BRIEFING_SCHEDULER_DISABLED = 'true';
    const service = createService();

    service.onModuleInit();

    expect(configFindMany).not.toHaveBeenCalled();
    expect(configUpdateMany).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });
});
