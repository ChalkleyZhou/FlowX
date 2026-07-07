import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingSchedulerService } from './briefing-scheduler.service';

describe('BriefingSchedulerService', () => {
  const configFindMany = vi.fn();
  const configUpdateMany = vi.fn();
  const configUpdate = vi.fn();
  const generateProjectBriefing = vi.fn();
  const sendBriefing = vi.fn();
  const generateProjectDailyCodeReview = vi.fn();
  const sendDailyCodeReview = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    configUpdateMany.mockResolvedValue({ count: 0 });
    configUpdate.mockResolvedValue({});
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
      {
        generateProjectDailyCodeReview,
        sendDailyCodeReview,
      } as never,
    );
  }

  it('generates and sends due project briefings and daily code reviews', async () => {
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
    generateProjectDailyCodeReview.mockResolvedValue({ id: 'review-1', sentAt: null });
    sendDailyCodeReview.mockResolvedValue({ successCount: 1, targetCount: 1 });

    await expect(
      createService().runDueBriefings(new Date('2026-06-03T10:00:00.000Z')),
    ).resolves.toEqual({ generatedCount: 1 });

    expect(generateProjectBriefing).toHaveBeenCalledWith('project-1', {
      date: '2026-06-03',
      regenerate: true,
    });
    expect(sendBriefing).toHaveBeenCalledWith('briefing-1');
    expect(generateProjectDailyCodeReview).toHaveBeenCalledWith('project-1', {
      date: '2026-06-03',
      regenerate: true,
    });
    expect(sendDailyCodeReview).toHaveBeenCalledWith('review-1');
    expect(configUpdate).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: expect.objectContaining({
        lastSchedulerSlot: '2026-06-03@18',
        lastCodeReviewSchedulerSlot: '2026-06-03@18',
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
    expect(generateProjectDailyCodeReview).not.toHaveBeenCalled();
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
    generateProjectDailyCodeReview.mockResolvedValue({ id: 'review-1', sentAt: null });
    sendDailyCodeReview.mockResolvedValue({ successCount: 0, targetCount: 0 });

    await createService().runDueBriefings(new Date('2026-06-03T10:00:00.000Z'));

    expect(configUpdate).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: expect.objectContaining({
        lastSchedulerMessage: expect.stringContaining('未配置启用的投递目标'),
      }),
    });
    expect(configUpdate.mock.calls[0]?.[0].data.lastSchedulerSlot).toBeUndefined();
  });
});
