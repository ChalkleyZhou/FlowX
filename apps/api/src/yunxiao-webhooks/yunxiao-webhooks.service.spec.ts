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
  const integrationFindFirst = vi.fn();
  const deliveryCreate = vi.fn();
  const deliveryFindUnique = vi.fn();
  const deliveryUpdate = vi.fn();
  const deliveryUpdateMany = vi.fn();
  const recipientUpsert = vi.fn();
  const sendPersonalMarkdown = vi.fn();
  const isYunxiaoEnabled = vi.fn();
  const listProjectMembers = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    integrationFindFirst.mockResolvedValue({ organizationId: 'org-1' });
    deliveryCreate.mockResolvedValue({ id: 'delivery-1' });
    deliveryUpdate.mockResolvedValue({ id: 'delivery-1' });
    sendPersonalMarkdown.mockResolvedValue({ errcode: 0, task_id: 123 });
    isYunxiaoEnabled.mockResolvedValue(true);
    recipientUpsert.mockResolvedValue({ id: 'recipient-audit-1' });
    listProjectMembers.mockResolvedValue([
      { identifier: 'yunxiao-user-1', dingTalkId: 'dingtalk-user-1', displayName: '张三', stamp: 'User' },
      { identifier: 'yunxiao-user-2', dingTalkId: 'dingtalk-user-2', displayName: '李四', stamp: 'User' },
      { identifier: 'yunxiao-user-3', dingTalkId: 'dingtalk-user-3', displayName: '王五', stamp: 'User' },
    ]);
  });

  function createService(secret = 'yunxiao-secret') {
    return new YunxiaoWebhooksService(
      {
        get: (key: string) => key === 'YUNXIAO_WEBHOOK_SECRET' ? secret : undefined,
      } as ConfigService,
      {
        userOrganization: { findMany: membershipFindMany },
        externalIntegration: { findFirst: integrationFindFirst },
        yunxiaoWebhookDelivery: {
          create: deliveryCreate,
          findUnique: deliveryFindUnique,
          update: deliveryUpdate,
          updateMany: deliveryUpdateMany,
        },
        yunxiaoWebhookRecipient: { upsert: recipientUpsert },
      } as never,
      { sendPersonalMarkdown } as never,
      { isEnabled: isYunxiaoEnabled } as never,
      { isConfigured: () => true, listProjectMembers } as never,
    );
  }

  const payload = {
    organizationIdentifier: 'yunxiao-org-1',
    id: 'workitem-42',
    serialNumber: 'PROJ-42',
    subject: '支付回调异常处理',
    gmtModified: '2026-08-28T15:00:00+08:00',
    assignedTo: { id: 'yunxiao-user-1', name: '张三' },
    status: { id: 'status-1', name: '处理中', displayName: '处理中' },
    space: { id: 'space-1', name: '支付平台' },
    url: 'https://devops.aliyun.com/workitem/workitem-42',
  };
  const singleDeliveryResult = {
    accepted: true,
    duplicate: false,
    deliveryIds: ['delivery-1'],
    recipientCount: 1,
    sentCount: 1,
    duplicateCount: 0,
    unmatchedCount: 0,
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

  it('通过云效成员 ID 和 dingTalkId 匹配唯一的钉钉组织成员并发送个人消息', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
      member('user-2', '李四', 'org-1', 'corp-1'),
    ]);

    await expect(createService().receive('yunxiao-secret', payload)).resolves.toEqual(
      singleDeliveryResult,
    );

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
    expect(listProjectMembers).toHaveBeenCalledWith('yunxiao-org-1', 'space-1');
  });

  it('通过 dingTalkId 优先匹配 FlowX 用户账号而不使用姓名', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '钉钉张三', 'org-1', 'corp-1', 'yunxiao-user-1'),
      member('user-2', '张三', 'org-1', 'corp-1'),
    ]);

    await expect(createService().receive('yunxiao-secret', payload)).resolves.toEqual(
      singleDeliveryResult,
    );
    expect(sendPersonalMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ flowxUserId: 'user-1' }),
    );
  });

  it('默认通知负责人、参与者、验证者和创建者，并按 FlowX 用户去重', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
      member('user-2', '李四', 'org-1', 'corp-1'),
      member('user-3', '王五', 'org-1', 'corp-1'),
    ]);
    deliveryCreate
      .mockResolvedValueOnce({ id: 'delivery-user-1' })
      .mockResolvedValueOnce({ id: 'delivery-user-2' })
      .mockResolvedValueOnce({ id: 'delivery-user-3' });

    await expect(createService().receive('yunxiao-secret', {
      ...payload,
      participants: [
        { identifier: 'yunxiao-user-2', realName: '李四' },
        { identifier: 'yunxiao-user-1', realName: '张三' },
      ],
      verifier: { identifier: 'yunxiao-user-3', displayName: '王五' },
      creator: { identifier: 'yunxiao-user-1', realName: '张三' },
    })).resolves.toEqual({
      accepted: true,
      duplicate: false,
      deliveryIds: ['delivery-user-1', 'delivery-user-2', 'delivery-user-3'],
      recipientCount: 3,
      sentCount: 3,
      duplicateCount: 0,
      unmatchedCount: 0,
    });

    expect(sendPersonalMarkdown.mock.calls.map(([request]) => request.flowxUserId)).toEqual([
      'user-1',
      'user-2',
      'user-3',
    ]);
    expect(deliveryCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        matchedUserId: 'user-1',
        matchedBy: 'assignedTo.id',
        recipient: {
          id: 'yunxiao-user-1',
          name: '张三',
          roles: ['assignedTo', 'participant', 'creator'],
        },
      }),
    });
  });

  it('可选接收人未匹配时仍通知其他已匹配人员', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
    ]);

    await expect(createService().receive('yunxiao-secret', {
      ...payload,
      participants: [{ realName: '未同步用户' }],
    })).resolves.toEqual({
      ...singleDeliveryResult,
      unmatchedCount: 1,
    });
    expect(sendPersonalMarkdown).toHaveBeenCalledOnce();
    expect(recipientUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        yunxiaoDisplayName: '未同步用户',
        status: 'UNMATCHED',
        reason: 'Yunxiao recipient identifier is missing.',
      }),
    }));
  });

  it('云效成员没有 dingTalkId 时不猜测姓名并记录未匹配原因', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
    ]);
    listProjectMembers.mockResolvedValue([
      { identifier: 'yunxiao-user-1', dingTalkId: null, displayName: '张三', stamp: 'User' },
    ]);

    await expect(createService().receive('yunxiao-secret', payload)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(sendPersonalMarkdown).not.toHaveBeenCalled();
    expect(recipientUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: 'UNMATCHED',
        reason: 'Yunxiao project member has no DingTalk id.',
      }),
    }));
  });

  it('兼容云效真实工作项中的 identifier、realName 和数字字段', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
    ]);

    await expect(createService().receive('yunxiao-secret', {
      organizationIdentifier: 'yunxiao-org-1',
      identifier: 'workitem-42',
      serialNumber: 2458,
      subject: '支付回调异常处理',
      gmtModified: 1788164768000,
      spaceIdentifier: '983799fb8586b44f19455511c8',
      category: 'Bug',
      assignedTo: {
        identifier: 'yunxiao-user-1',
        realName: '张三',
        displayName: '张三',
      },
      status: { identifier: '28', name: '待确认', displayName: '待确认' },
      space: { identifier: 'space-1', name: '支付平台' },
    })).resolves.toEqual(singleDeliveryResult);

    expect(deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: 'workitem-42:1788164768000',
        recipient: {
          id: 'yunxiao-user-1',
          name: '张三',
          roles: ['assignedTo'],
        },
      }),
    });
    expect(membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org-1' }),
    }));
    expect(sendPersonalMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: expect.stringContaining(
          '[查看工作项](https://devops.aliyun.com/projex/project/983799fb8586b44f19455511c8/bug#openWorkitemIdentifier=workitem-42)',
        ),
      }),
    );
  });

  it('根据项目、类别、视图和工作项标识自动生成云效链接', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
    ]);

    await createService().receive('yunxiao-secret', {
      ...payload,
      id: undefined,
      url: undefined,
      projectId: '983799fb8586b44f19455511c8',
      categoryId: 'bug',
      identifier: '1dedc5afd44979211cad516f',
      workItemIdentifier: '919c1dd6a2c6a722ace76842e9',
    });

    const expectedUrl = [
      'https://devops.aliyun.com/projex/project/983799fb8586b44f19455511c8/bug',
      '#viewIdentifier=1dedc5afd44979211cad516f',
      '&openWorkitemIdentifier=919c1dd6a2c6a722ace76842e9',
    ].join('');
    expect(sendPersonalMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: expect.stringContaining(`[查看工作项](${expectedUrl})`),
      }),
    );
    expect(deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: '919c1dd6a2c6a722ace76842e9:2026-08-28T15:00:00+08:00',
        linkUrl: expectedUrl,
      }),
    });
  });

  it('没有云效组织绑定时拒绝跨组织匹配', async () => {
    integrationFindFirst.mockResolvedValue(null);

    await expect(createService().receive('yunxiao-secret', payload)).rejects.toThrow(
      'No FlowX organization is mapped to the Yunxiao organization.',
    );
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it('工作项缺少负责人时拒绝处理', async () => {
    await expect(
      createService().receive('yunxiao-secret', { ...payload, assignedTo: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it('同一 dingTalkId 对应多个 FlowX 成员时拒绝投递', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1', null, 'dingtalk-user-1'),
      member('user-2', '张三', 'org-2', 'corp-2', null, 'dingtalk-user-1'),
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
      deliveryIds: ['delivery-1'],
      recipientCount: 1,
      sentCount: 0,
      duplicateCount: 1,
      unmatchedCount: 0,
    });
    expect(deliveryFindUnique).toHaveBeenCalledWith({
      where: {
        organizationId_eventId_matchedUserId: {
          organizationId: 'org-1',
          eventId: 'workitem-42:2026-08-28T15:00:00+08:00',
          matchedUserId: 'user-1',
        },
      },
      select: { id: true, status: true },
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

    await expect(createService().receive('yunxiao-secret', payload)).resolves.toEqual(
      singleDeliveryResult,
    );
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

  it('多人通知中单个发送失败时继续发送其他接收人', async () => {
    membershipFindMany.mockResolvedValue([
      member('user-1', '张三', 'org-1', 'corp-1'),
      member('user-2', '李四', 'org-1', 'corp-1'),
    ]);
    deliveryCreate
      .mockResolvedValueOnce({ id: 'delivery-user-1' })
      .mockResolvedValueOnce({ id: 'delivery-user-2' });
    sendPersonalMarkdown
      .mockRejectedValueOnce(new Error('provider failure'))
      .mockResolvedValueOnce({ errcode: 0, task_id: 456 });

    await expect(createService().receive('yunxiao-secret', {
      ...payload,
      participants: [{ identifier: 'yunxiao-user-2', realName: '李四' }],
    })).rejects.toMatchObject({
      status: 502,
      response: expect.objectContaining({
        recipientCount: 2,
        sentCount: 1,
        failedCount: 1,
      }),
    });
    expect(sendPersonalMarkdown).toHaveBeenCalledTimes(2);
    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: 'delivery-user-1' },
      data: {
        status: 'FAILED',
        errorMessage: 'DingTalk message delivery failed.',
      },
    });
    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: 'delivery-user-2' },
      data: expect.objectContaining({ status: 'SENT' }),
    });
  });

  it('云效集成停用时接受请求但不发送通知', async () => {
    isYunxiaoEnabled.mockResolvedValue(false);

    await expect(createService().receive('yunxiao-secret', payload)).resolves.toEqual({
      accepted: true,
      disabled: true,
    });
    expect(deliveryCreate).not.toHaveBeenCalled();
    expect(sendPersonalMarkdown).not.toHaveBeenCalled();
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(listProjectMembers).not.toHaveBeenCalled();
  });
});

function member(
  userId: string,
  displayName: string,
  organizationId: string,
  corpId: string,
  account: string | null = null,
  dingTalkId = `dingtalk-${userId}`,
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
      identities: [{
        providerUserId: `staff:${corpId}:${dingTalkId}`,
        providerUnionId: null,
        providerRawProfile: { userid: dingTalkId },
      }],
    },
  };
}
