import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { YunxiaoWebhooksController } from './yunxiao-webhooks.controller';

describe('YunxiaoWebhooksController', () => {
  const authSession = {
    user: { id: 'user-1' },
    organization: { id: 'org-1' },
  };

  it('使用当前用户和组织读取配置', async () => {
    const getOrCreateConfig = vi.fn().mockResolvedValue({ id: 'config-1' });
    const controller = new YunxiaoWebhooksController({ getOrCreateConfig } as never);

    await expect(controller.getConfig({ authSession })).resolves.toEqual({ id: 'config-1' });
    expect(getOrCreateConfig).toHaveBeenCalledWith('org-1', 'user-1');
  });

  it('将公开事件和 Secret 交给服务处理', async () => {
    const receive = vi.fn().mockResolvedValue({ accepted: true });
    const controller = new YunxiaoWebhooksController({ receive } as never);
    const payload = {
      eventId: 'event-1',
      recipient: { email: 'alice@example.com' },
      title: '状态变更',
      markdown: '任务已更新',
    };

    await expect(controller.receive('config-1', 'secret-1', payload)).resolves.toEqual({
      accepted: true,
    });
    expect(receive).toHaveBeenCalledWith('config-1', 'secret-1', payload);
  });

  it('拒绝缺少用户或组织的配置请求', () => {
    const controller = new YunxiaoWebhooksController({} as never);

    expect(() => controller.getConfig({ authSession: { organization: { id: 'org-1' } } })).toThrow(
      UnauthorizedException,
    );
    expect(() => controller.getConfig({ authSession: { user: { id: 'user-1' } } })).toThrow(
      BadRequestException,
    );
  });
});
