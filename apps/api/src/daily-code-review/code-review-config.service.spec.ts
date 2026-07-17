import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeReviewConfigService } from './code-review-config.service';

describe('CodeReviewConfigService', () => {
  const projectFindUnique = vi.fn();
  const briefingConfigFindUnique = vi.fn();
  const codeReviewConfigFindUnique = vi.fn();
  const codeReviewConfigUpsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new CodeReviewConfigService({
      project: { findUnique: projectFindUnique },
      projectBriefingConfig: { findUnique: briefingConfigFindUnique },
      projectCodeReviewConfig: {
        findUnique: codeReviewConfigFindUnique,
        upsert: codeReviewConfigUpsert,
      },
    } as never);
  }

  it('returns default project config when no config exists', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1' });
    codeReviewConfigFindUnique.mockResolvedValue(null);

    await expect(createService().getProjectConfig('project-1')).resolves.toEqual({
      projectId: 'project-1',
      enabled: false,
      dailyHour: 22,
      timezone: 'Asia/Shanghai',
      autoSend: false,
      lastSchedulerSlot: null,
      lastSchedulerRunAt: null,
      lastSchedulerMessage: null,
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

  it('upserts code review config without changing briefing config', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1' });
    codeReviewConfigUpsert.mockResolvedValue({
      id: 'cr-config-1',
      projectId: 'project-1',
      enabled: true,
      dailyHour: 9,
      timezone: 'Asia/Shanghai',
      autoSend: true,
    });

    const service = createService();
    const cr = await service.upsertProjectConfig('project-1', {
      enabled: true,
      dailyHour: 9,
      autoSend: true,
    });

    expect(cr.enabled).toBe(true);
    expect(cr.dailyHour).toBe(9);
    expect(codeReviewConfigUpsert).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      create: {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 9,
        timezone: 'Asia/Shanghai',
        autoSend: true,
      },
      update: {
        timezone: 'Asia/Shanghai',
        enabled: true,
        autoSend: true,
        dailyHour: 9,
        lastSchedulerSlot: null,
      },
    });
    expect(briefingConfigFindUnique).not.toHaveBeenCalled();
  });

  it('preserves dailyHour when toggling enabled without sending hour', async () => {
    projectFindUnique.mockResolvedValue({ id: 'project-1' });
    codeReviewConfigUpsert.mockResolvedValue({
      id: 'cr-config-1',
      enabled: true,
      dailyHour: 9,
    });

    await expect(
      createService().upsertProjectConfig('project-1', { enabled: true }),
    ).resolves.toEqual({ id: 'cr-config-1', enabled: true, dailyHour: 9 });

    expect(codeReviewConfigUpsert).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      create: {
        projectId: 'project-1',
        enabled: true,
        dailyHour: 22,
        timezone: 'Asia/Shanghai',
        autoSend: false,
      },
      update: {
        timezone: 'Asia/Shanghai',
        enabled: true,
        autoSend: true,
      },
    });
  });

  it('rejects config upserts for missing projects', async () => {
    projectFindUnique.mockResolvedValue(null);

    await expect(
      createService().upsertProjectConfig('missing', { enabled: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(codeReviewConfigUpsert).not.toHaveBeenCalled();
  });
});
