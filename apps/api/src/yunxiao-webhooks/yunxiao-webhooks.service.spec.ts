import {
  BadGatewayException,
  ForbiddenException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YunxiaoWebhooksService } from './yunxiao-webhooks.service';

describe('YunxiaoWebhooksService', () => {
  const organizationFindUnique = vi.fn();
  const membershipFindUnique = vi.fn();
  const membershipFindMany = vi.fn();
  const configFindUnique = vi.fn();
  const configUpsert = vi.fn();
  const deliveryCreate = vi.fn();
  const deliveryFindUnique = vi.fn();
  const deliveryUpdate = vi.fn();
  const deliveryUpdateMany = vi.fn();
  const sendPersonalMarkdown = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindUnique.mockResolvedValue({
      id: 'org-1',
      provider: 'dingtalk',
      providerOrganizationId: 'corp-1',
    });
    membershipFindUnique.mockResolvedValue({ role: 'admin' });
    configFindUnique.mockResolvedValue({
      id: 'config-1',
      organizationId: 'org-1',
      webhookSecret: 'secret-1',
      isActive: true,
    });
    deliveryCreate.mockResolvedValue({ id: 'delivery-1' });
    deliveryUpdate.mockResolvedValue({ id: 'delivery-1' });
    sendPersonalMarkdown.mockResolvedValue({ errcode: 0, task_id: 123 });
  });

  function createService() {
    return new YunxiaoWebhooksService(
      {
        organization: { findUnique: organizationFindUnique },
        userOrganization: {
          findUnique: membershipFindUnique,
          findMany: membershipFindMany,
        },
        yunxiaoWebhookConfig: {
          findUnique: configFindUnique,
          upsert: configUpsert,
        },
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
    eventId: 'workitem-42-status-changed-20260828',
    recipient: { email: 'alice@example.com' },
    title: '云效任务状态变更',
    markdown: '任务 **支付回调** 已进入待处理状态。',
    url: 'https://devops.aliyun.com/workitem/42',
  };

  it('仅允许组织管理员读取或创建 Webhook 配置', async () => {
    membershipFindUnique.mockResolvedValue({ role: 'member' });

    await expect(createService().getOrCreateConfig('org-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('拒绝无效的 Webhook Secret', async () => {
    await expect(
      createService().receive('config-1', 'wrong-secret', payload),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(deliveryCreate).not.toHaveBeenCalled();
    expect(sendPersonalMarkdown).not.toHaveBeenCalled();
  });

  it('优先按钉钉 userid 匹配组织成员并发送个人消息', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', 'Alice', {
        email: 'alice@example.com',
        rawProfile: { userid: 'staff-1' },
      }),
      member('user-2', 'Bob', {
        email: 'bob@example.com',
        rawProfile: { userid: 'staff-2' },
      }),
    ]);

    const result = await createService().receive('config-1', 'secret-1', {
      ...payload,
      recipient: {
        dingtalkUserId: 'staff-2',
        email: 'alice@example.com',
      },
    });

    expect(result).toEqual({
      accepted: true,
      duplicate: false,
      deliveryId: 'delivery-1',
      matchedBy: 'dingtalkUserId',
    });
    expect(sendPersonalMarkdown).toHaveBeenCalledWith({
      flowxUserId: 'user-2',
      corpId: 'corp-1',
      title: payload.title,
      markdown: `${payload.markdown}\n\n[查看详情](${payload.url})`,
    });
    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({
        status: 'SENT',
        matchedUserId: 'user-2',
        matchedBy: 'dingtalkUserId',
        sentAt: expect.any(Date),
      }),
    });
  });

  it('找不到接收人时记录失败且不发送消息', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', 'Alice', { email: 'alice@example.com' }),
    ]);

    await expect(
      createService().receive('config-1', 'secret-1', {
        ...payload,
        recipient: { email: 'missing@example.com' },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(sendPersonalMarkdown).not.toHaveBeenCalled();
    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({ status: 'NO_MATCH' }),
    });
  });

  it('姓名匹配到多个成员时拒绝投递', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', { email: 'zhangsan-1@example.com' }),
      member('user-2', '张三', { email: 'zhangsan-2@example.com' }),
    ]);

    await expect(
      createService().receive('config-1', 'secret-1', {
        ...payload,
        recipient: { name: '张三' },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(sendPersonalMarkdown).not.toHaveBeenCalled();
    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({ status: 'AMBIGUOUS' }),
    });
  });

  it('已成功处理的事件重复到达时不重复发送', async () => {
    deliveryCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      }),
    );
    deliveryFindUnique.mockResolvedValue({
      id: 'delivery-1',
      status: 'SENT',
    });

    await expect(createService().receive('config-1', 'secret-1', payload)).resolves.toEqual({
      accepted: true,
      duplicate: true,
      deliveryId: 'delivery-1',
      status: 'SENT',
    });
    expect(sendPersonalMarkdown).not.toHaveBeenCalled();
  });

  it('允许使用相同事件 ID 重试之前失败的投递', async () => {
    deliveryCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      }),
    );
    deliveryFindUnique.mockResolvedValue({
      id: 'delivery-1',
      status: 'FAILED',
    });
    deliveryUpdateMany.mockResolvedValue({ count: 1 });
    membershipFindMany.mockResolvedValue([
      member('user-1', 'Alice', { email: 'alice@example.com' }),
    ]);

    await expect(createService().receive('config-1', 'secret-1', payload)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      deliveryId: 'delivery-1',
      matchedBy: 'email',
    });
    expect(deliveryUpdateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-1', status: 'FAILED' },
      data: expect.objectContaining({ status: 'PROCESSING' }),
    });
    expect(sendPersonalMarkdown).toHaveBeenCalledOnce();
  });

  it('钉钉发送失败时记录通用错误且不泄露提供方响应', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', 'Alice', { email: 'alice@example.com' }),
    ]);
    sendPersonalMarkdown.mockRejectedValue(new Error('token=secret-provider-error'));

    await expect(
      createService().receive('config-1', 'secret-1', payload),
    ).rejects.toBeInstanceOf(BadGatewayException);

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
  input: {
    email?: string;
    account?: string;
    unionId?: string;
    rawProfile?: Record<string, unknown>;
  },
) {
  return {
    userId,
    user: {
      id: userId,
      displayName,
      email: input.email ?? null,
      account: input.account ?? null,
      status: 'ACTIVE',
      localCredential: null,
      identities: [
        {
          provider: 'dingtalk',
          providerUserId: `corp-1:${String(input.rawProfile?.userid ?? userId)}`,
          providerUnionId: input.unionId ?? null,
          providerRawProfile: input.rawProfile ?? {},
        },
      ],
    },
  };
}
