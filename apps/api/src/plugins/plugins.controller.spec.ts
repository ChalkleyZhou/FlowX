import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PluginsController } from './plugins.controller';

describe('PluginsController', () => {
  it('读取当前组织的云效状态', async () => {
    const getYunxiaoStatus = vi.fn().mockResolvedValue({ enabled: true });
    const controller = new PluginsController({
      get: vi.fn().mockReturnValue({ getStatus: getYunxiaoStatus }),
    } as never);

    await expect(controller.getYunxiao({
      authSession: { organization: { id: 'org-1' } },
    })).resolves.toEqual({ enabled: true });
    expect(getYunxiaoStatus).toHaveBeenCalledWith('org-1');
  });

  it('没有组织时拒绝修改云效状态', async () => {
    const controller = new PluginsController({ get: vi.fn() } as never);

    expect(() => controller.updateYunxiao(
      { enabled: false },
      { authSession: { user: { id: 'user-1' }, organization: null } },
    )).toThrow(BadRequestException);
  });

  it('更新云效开关时可以同时保存组织绑定', async () => {
    const updateStatus = vi.fn().mockResolvedValue({ enabled: true });
    const controller = new PluginsController({
      get: vi.fn().mockReturnValue({ updateStatus }),
    } as never);

    await expect(controller.updateYunxiao(
      {
        enabled: true,
        yunxiaoOrganizationIdentifier: 'yunxiao-org-1',
      },
      { authSession: { user: { id: 'user-1' }, organization: { id: 'org-1' } } },
    )).resolves.toEqual({ enabled: true });
    expect(updateStatus).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      true,
      { yunxiaoOrganizationIdentifier: 'yunxiao-org-1' },
    );
  });
});
