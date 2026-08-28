import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YunxiaoWebhooksService } from './yunxiao-webhooks.service';

describe('YunxiaoWebhooksService', () => {
  const membershipFindMany = vi.fn();
  const deliveryCreate = vi.fn();
  const deliveryFindUnique = vi.fn();
  const deliveryUpdate = vi.fn();
  const deliveryUpdateMany = vi.fn();
  const sendPersonalMarkdown = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    deliveryCreate.mockResolvedValue({ id: 'delivery-1' });
    deliveryUpdate.mockResolvedValue({ id: 'delivery-1' });
    sendPersonalMarkdown.mockResolvedValue({ errcode: 0, task_id: 123 });
  });

  function createService(secret = 'yunxiao-secret') {
    return new YunxiaoWebhooksService(
      {
        get: (key: string) => key === 'YUNXIAO_WEBHOOK_SECRET' ? secret : undefined,
      } as ConfigService,
      {
        userOrganization: { findMany: membershipFindMany },
        yunxiaoWebhookDelivery: {
          create: deliveryCreate,
          findUnique: deliveryFindUnique,
          update: deliveryUpdate,
          updateMany: deliveryUpdateMany,
        },
      } as never,
      { sendPersonalMarkdown } as never,
    );
  }

  const payload = {
    id: 'workitem-42',
    serialNumber: 'PROJ-42',
    subject: '支付回调异常处理',
    gmtModified: '2026-08-28T15:00:00+08:00',
    assignedTo: { id: 'yunxiao-user-1', name: '张三' },
    status: { id: 'status-1', name: '处理中', displayName: '处理中' },
    space: { id: 'space-1', name: '支付平台' },
    url: 'https://devops.aliyun.com/workitem/workitem-42',
  };

  it('按云效 X-Projex-Signature 校验 Secret', async () => {
    await expect(createService().receive('wrong-secret', payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it('服务端未配置 Secret 时拒绝接收', async () => {
    await expect(createService('').receive('yunxiao-secret', payload)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('按负责人姓名匹配唯一的钉钉组织成员并发送个人消息', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
      member('user-2', '李四', 'org-1', 'corp-1'),
    ]);

    await expect(createService().receive('yunxiao-secret', payload)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      deliveryId: 'delivery-1',
      matchedBy: 'assignedTo.name',
    });

    expect(sendPersonalMarkdown).toHaveBeenCalledWith({
      flowxUserId: 'user-1',
      corpId: 'corp-1',
      title: '云效工作项：支付回调异常处理',
      markdown: [
        '## 支付回调异常处理',
        '',
        '- 编号：PROJ-42',
        '- 项目：支付平台',
        '- 状态：处理中',
        '- 负责人：张三',
        '',
        '[查看工作项](https://devops.aliyun.com/workitem/workitem-42)',
      ].join('\n'),
    });
    expect(deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        eventId: 'workitem-42:2026-08-28T15:00:00+08:00',
        matchedUserId: 'user-1',
      }),
    });
  });

  it('优先按负责人 ID 匹配 FlowX 用户账号', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '钉钉张三', 'org-1', 'corp-1', 'yunxiao-user-1'),
      member('user-2', '张三', 'org-1', 'corp-1'),
    ]);

    await expect(createService().receive('yunxiao-secret', payload)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      deliveryId: 'delivery-1',
      matchedBy: 'assignedTo.id',
    });
    expect(sendPersonalMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ flowxUserId: 'user-1' }),
    );
  });

  it('工作项缺少负责人时拒绝处理', async () => {
    await expect(
      createService().receive('yunxiao-secret', { ...payload, assignedTo: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it('负责人姓名在多个钉钉组织成员中重复时拒绝投递', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
      member('user-2', '张三', 'org-2', 'corp-2'),
    ]);

    await expect(createService().receive('yunxiao-secret', payload)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(sendPersonalMarkdown).not.toHaveBeenCalled();
  });

  it('同一组织中已成功处理的事件不会重复发送', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
    ]);
    deliveryCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      }),
    );
    deliveryFindUnique.mockResolvedValue({ id: 'delivery-1', status: 'SENT' });

    await expect(createService().receive('yunxiao-secret', payload)).resolves.toEqual({
      accepted: true,
      duplicate: true,
      deliveryId: 'delivery-1',
      status: 'SENT',
    });
    expect(sendPersonalMarkdown).not.toHaveBeenCalled();
  });

  it('允许重试之前发送失败的同一事件', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
    ]);
    deliveryCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      }),
    );
    deliveryFindUnique.mockResolvedValue({ id: 'delivery-1', status: 'FAILED' });
    deliveryUpdateMany.mockResolvedValue({ count: 1 });

    await expect(createService().receive('yunxiao-secret', payload)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      deliveryId: 'delivery-1',
      matchedBy: 'assignedTo.name',
    });
    expect(deliveryUpdateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-1', status: 'FAILED' },
      data: expect.objectContaining({ status: 'PROCESSING' }),
    });
    expect(sendPersonalMarkdown).toHaveBeenCalledOnce();
  });

  it('钉钉发送失败时记录通用错误', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
    ]);
    sendPersonalMarkdown.mockRejectedValue(new Error('token=secret-provider-error'));

    await expect(createService().receive('yunxiao-secret', payload)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'FAILED',
        errorMessage: 'DingTalk message delivery failed.',
      },
    });
  });
});

function member(
  userId: string,
  displayName: string,
  organizationId: string,
  corpId: string,
  account: string | null = null,
) {
  return {
    userId,
    organizationId,
    organization: {
      id: organizationId,
      provider: 'dingtalk',
      providerOrganizationId: corpId,
    },
    user: {
      id: userId,
      displayName,
      account,
      email: null,
      status: 'ACTIVE',
      localCredential: null,
    },
  };
}
