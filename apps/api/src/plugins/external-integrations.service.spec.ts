import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalIntegrationsService } from './external-integrations.service';

describe('ExternalIntegrationsService', () => {
  const findFirst = vi.fn();
  const findUnique = vi.fn();
  const create = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService(secret = 'yunxiao-secret') {
    return new ExternalIntegrationsService(
      {
        externalIntegration: { findFirst, create, update },
        userOrganization: { findUnique },
      } as never,
      {
        get: (key: string) => key === 'YUNXIAO_WEBHOOK_SECRET' ? secret : undefined,
      } as never,
    );
  }

  it('没有数据库记录时沿用已配置 Secret 的兼容默认状态', async () => {
    findFirst.mockResolvedValue(null);

    await expect(createService().getYunxiaoStatus('org-1')).resolves.toEqual({
      provider: 'YUNXIAO',
      enabled: true,
      configured: true,
      webhookPath: '/api/yunxiao-webhooks',
    });
  });

  it('管理员可以持久化停用状态', async () => {
    findUnique.mockResolvedValue({ role: 'admin' });
    findFirst.mockResolvedValue({ id: 'integration-1', enabled: true });
    update.mockResolvedValue({ enabled: false });

    await expect(createService().updateYunxiaoStatus('org-1', 'user-1', false)).resolves.toMatchObject({
      provider: 'YUNXIAO',
      enabled: false,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'integration-1' },
      data: { enabled: false },
    });
  });

  it('非管理员不能切换云效开关', async () => {
    findUnique.mockResolvedValue({ role: 'member' });

    await expect(createService().updateYunxiaoStatus('org-1', 'user-1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('没有配置 Secret 时报告未配置', async () => {
    findFirst.mockResolvedValue({ enabled: false });

    await expect(createService('').getYunxiaoStatus('org-1')).resolves.toMatchObject({
      enabled: false,
      configured: false,
    });
  });

  it('没有配置 Secret 时不能启用云效', async () => {
    await expect(createService('').updateYunxiaoStatus('org-1', 'user-1', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});
