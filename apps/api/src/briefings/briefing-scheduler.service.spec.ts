import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingSchedulerService } from './briefing-scheduler.service';

describe('BriefingSchedulerService', () => {
  const configFindMany = vi.fn();
  const generateProjectBriefing = vi.fn();
  const sendBriefing = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new BriefingSchedulerService(
      {
        projectBriefingConfig: {
          findMany: configFindMany,
        },
      } as never,
      {
        generateProjectBriefing,
        sendBriefing,
      } as never,
    );
  }

  it('generates due project briefings for the configured timezone hour', async () => {
    configFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 18,
        timezone: 'Asia/Shanghai',
        autoSend: false,
        project: { id: 'project-1' },
      },
    ]);
    generateProjectBriefing.mockResolvedValue({ id: 'briefing-1' });

    await expect(
      createService().runDueBriefings(new Date('2026-06-03T10:00:00.000Z')),
    ).resolves.toEqual({ generatedCount: 1 });

    expect(generateProjectBriefing).toHaveBeenCalledWith('project-1', {
      date: '2026-06-03',
    });
    expect(sendBriefing).not.toHaveBeenCalled();
  });

  it('skips configs that are not due yet', async () => {
    configFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 17,
        timezone: 'Asia/Shanghai',
        autoSend: true,
        project: { id: 'project-1' },
      },
    ]);

    await expect(
      createService().runDueBriefings(new Date('2026-06-03T10:00:00.000Z')),
    ).resolves.toEqual({ generatedCount: 0 });

    expect(generateProjectBriefing).not.toHaveBeenCalled();
    expect(sendBriefing).not.toHaveBeenCalled();
  });

  it('sends generated briefings when autoSend is enabled', async () => {
    configFindMany.mockResolvedValue([
      {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 18,
        timezone: 'Asia/Shanghai',
        autoSend: true,
        project: { id: 'project-1' },
      },
    ]);
    generateProjectBriefing.mockResolvedValue({ id: 'briefing-1' });

    await createService().runDueBriefings(new Date('2026-06-03T10:00:00.000Z'));

    expect(sendBriefing).toHaveBeenCalledWith('briefing-1');
  });
});

