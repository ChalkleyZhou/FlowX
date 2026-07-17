import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeReviewSchedulerService } from './code-review-scheduler.service';

vi.mock('../briefings/briefing-auth-session', () => ({
  resolveProjectOrganizationId: vi.fn(),
  buildSchedulerAuthSession: vi.fn(),
}));

import {
  buildSchedulerAuthSession,
  resolveProjectOrganizationId,
} from '../briefings/briefing-auth-session';

describe('CodeReviewSchedulerService', () => {
  const codeReviewConfigFindMany = vi.fn();
  const codeReviewConfigUpdate = vi.fn();
  const briefingConfigFindMany = vi.fn();
  const generateProjectDailyCodeReview = vi.fn();
  const sendDailyCodeReview = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    codeReviewConfigUpdate.mockResolvedValue({});
    vi.mocked(resolveProjectOrganizationId).mockResolvedValue('org-1');
    vi.mocked(buildSchedulerAuthSession).mockResolvedValue({
      organization: { id: 'org-1', name: '研发组织' },
    });
  });

  afterEach(() => {
    delete process.env.FLOWX_CODE_REVIEW_SCHEDULER_DISABLED;
  });

  function createService() {
    return new CodeReviewSchedulerService(
      {
        projectCodeReviewConfig: {
          findMany: codeReviewConfigFindMany,
          update: codeReviewConfigUpdate,
        },
        projectBriefingConfig: {
          findMany: briefingConfigFindMany,
        },
      } as never,
      {
        generateProjectDailyCodeReview,
        sendDailyCodeReview,
      } as never,
    );
  }

  it('generates and sends due code reviews without touching briefing configs', async () => {
    codeReviewConfigFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 18,
        lastSchedulerSlot: null,
        project: { id: 'project-1', name: 'FlowX' },
      },
    ]);
    generateProjectDailyCodeReview.mockResolvedValue({ id: 'review-1', sentAt: null });
    sendDailyCodeReview.mockResolvedValue({ successCount: 1, targetCount: 1 });

    await expect(
      createService().runDueCodeReviews(new Date('2026-06-03T10:00:00.000Z')),
    ).resolves.toEqual({ generatedCount: 1 });

    expect(codeReviewConfigFindMany).toHaveBeenCalledWith({
      where: { enabled: true },
      include: { project: true },
    });
    expect(generateProjectDailyCodeReview).toHaveBeenCalledWith(
      'project-1',
      {
        date: '2026-06-03',
        regenerate: true,
      },
      {
        organization: { id: 'org-1', name: '研发组织' },
      },
    );
    expect(sendDailyCodeReview).toHaveBeenCalledWith('review-1');
    expect(codeReviewConfigUpdate).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: expect.objectContaining({
        lastSchedulerSlot: '2026-06-03@18',
      }),
    });
    expect(briefingConfigFindMany).not.toHaveBeenCalled();
  });

  it('skips configs that are not due yet', async () => {
    codeReviewConfigFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 17,
        lastSchedulerSlot: null,
        project: { id: 'project-1', name: 'FlowX' },
      },
    ]);

    await expect(
      createService().runDueCodeReviews(new Date('2026-06-03T10:00:00.000Z')),
    ).resolves.toEqual({ generatedCount: 0 });

    expect(generateProjectDailyCodeReview).not.toHaveBeenCalled();
  });

  it('dedupes using ProjectCodeReviewConfig.lastSchedulerSlot, not the briefing slot', async () => {
    codeReviewConfigFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 18,
        lastSchedulerSlot: '2026-06-03@18',
        project: { id: 'project-1', name: 'FlowX' },
      },
    ]);

    await expect(
      createService().runDueCodeReviews(new Date('2026-06-03T10:00:00.000Z')),
    ).resolves.toEqual({ generatedCount: 0 });

    expect(generateProjectDailyCodeReview).not.toHaveBeenCalled();
  });

  it('records a delivery failure without locking the slot', async () => {
    codeReviewConfigFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 18,
        lastSchedulerSlot: null,
        project: { id: 'project-1', name: 'FlowX' },
      },
    ]);
    generateProjectDailyCodeReview.mockResolvedValue({ id: 'review-1', sentAt: null });
    sendDailyCodeReview.mockResolvedValue({ successCount: 0, targetCount: 0 });

    await createService().runDueCodeReviews(new Date('2026-06-03T10:00:00.000Z'));

    expect(codeReviewConfigUpdate).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: expect.objectContaining({
        lastSchedulerMessage: expect.stringContaining('未配置启用的投递目标'),
      }),
    });
    expect(codeReviewConfigUpdate.mock.calls[0]?.[0].data.lastSchedulerSlot).toBeUndefined();
  });

  it('does not run when FLOWX_CODE_REVIEW_SCHEDULER_DISABLED is true', () => {
    process.env.FLOWX_CODE_REVIEW_SCHEDULER_DISABLED = 'true';
    const service = createService();

    service.onModuleInit();

    expect(codeReviewConfigFindMany).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });
});
