import { describe, expect, it, vi } from 'vitest';
import { YunxiaoWebhooksController } from './yunxiao-webhooks.controller';

describe('YunxiaoWebhooksController', () => {
  it('从固定地址读取云效签名请求头并转交工作项数据', async () => {
    const receive = vi.fn().mockResolvedValue({ accepted: true });
    const controller = new YunxiaoWebhooksController({ receive } as never);
    const payload = {
      id: 'workitem-1',
      subject: '状态变更',
      assignedTo: { id: 'yunxiao-user-1', name: '张三' },
    };

    await expect(controller.receive('secret-1', payload)).resolves.toEqual({ accepted: true });
    expect(receive).toHaveBeenCalledWith('secret-1', payload);
  });
});
