import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryTargetsService } from './delivery-targets.service';

describe('DeliveryTargetsService', () => {
  const targetFindMany = vi.fn();
  const targetCreate = vi.fn();
  const targetUpdate = vi.fn();
  const targetDelete = vi.fn();
  const logDeleteMany = vi.fn();
  const logCreate = vi.fn();
  const briefingUpdate = vi.fn();
  const userOrganizationFindUnique = vi.fn();
  const organizationFindUnique = vi.fn();
  const transaction = vi.fn((callback) =>
    callback({
      deliveryLog: { deleteMany: logDeleteMany },
      deliveryTarget: { delete: targetDelete },
    }),
  );
  const sendDingTalkMarkdown = vi.fn();
  const sendEmail = vi.fn();
  const sendPersonalMarkdown = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService(options?: {
    authService?: { resolveOrganizationMemberEmail: ReturnType<typeof vi.fn> };
    dingTalkNotification?: { sendPersonalMarkdown: ReturnType<typeof vi.fn> };
  }) {
    return new DeliveryTargetsService(
      {
        deliveryTarget: {
          findMany: targetFindMany,
          create: targetCreate,
          update: targetUpdate,
        },
        deliveryLog: { create: logCreate },
        briefing: { update: briefingUpdate },
        userOrganization: { findUnique: userOrganizationFindUnique },
        organization: { findUnique: organizationFindUnique },
        $transaction: transaction,
      } as never,
      { sendDingTalkMarkdown, sendEmail },
      options?.authService as never,
      options?.dingTalkNotification as never,
    );
  }

  it('creates workspace-scoped delivery targets', async () => {
    targetCreate.mockResolvedValue({ id: 'target-1' });

    await expect(
      createService().createTarget({
        workspaceId: 'workspace-1',
        type: 'EMAIL',
        name: 'Team',
        emailAddress: 'team@example.com',
      }),
    ).resolves.toEqual({ id: 'target-1' });

    expect(targetCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        type: 'EMAIL',
        name: 'Team',
        userId: null,
        organizationId: null,
        emailAddress: 'team@example.com',
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
        isActive: true,
      },
    });
  });

  it('resolves member email when creating an email target with userId', async () => {
    const resolveOrganizationMemberEmail = vi.fn().mockResolvedValue({
      email: 'bob@company.com',
      source: 'dingtalk',
    });
    targetCreate.mockResolvedValue({ id: 'target-2' });

    await expect(
      createService({ authService: { resolveOrganizationMemberEmail } }).createTarget(
        {
          workspaceId: 'workspace-1',
          type: 'EMAIL',
          name: 'Bob',
          userId: 'user-bob',
        },
        'org-1',
      ),
    ).resolves.toEqual({ id: 'target-2' });

    expect(resolveOrganizationMemberEmail).toHaveBeenCalledWith('org-1', 'user-bob');
    expect(targetCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        type: 'EMAIL',
        name: 'Bob',
        userId: null,
        organizationId: null,
        emailAddress: 'bob@company.com',
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
        isActive: true,
      },
    });
  });

  it('creates DingTalk app delivery targets bound to organization members', async () => {
    userOrganizationFindUnique.mockResolvedValue({ userId: 'user-bob' });
    targetCreate.mockResolvedValue({ id: 'target-app' });

    await expect(
      createService().createTarget(
        {
          workspaceId: 'workspace-1',
          type: 'DINGTALK_APP',
          name: 'Bob',
          userId: 'user-bob',
        },
        'org-1',
      ),
    ).resolves.toEqual({ id: 'target-app' });

    expect(targetCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        type: 'DINGTALK_APP',
        name: 'Bob',
        userId: 'user-bob',
        organizationId: 'org-1',
        emailAddress: null,
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
        isActive: true,
      },
    });
  });

  it('deletes delivery logs before deleting a target', async () => {
    targetDelete.mockResolvedValue({ id: 'target-1' });

    await expect(createService().deleteTarget('target-1')).resolves.toEqual({
      id: 'target-1',
    });
    expect(logDeleteMany).toHaveBeenCalledWith({ where: { deliveryTargetId: 'target-1' } });
    expect(targetDelete).toHaveBeenCalledWith({ where: { id: 'target-1' } });
  });

  it('sends a briefing to active targets and records success and failure logs', async () => {
    targetFindMany.mockResolvedValue([
      {
        id: 'target-email',
        type: 'EMAIL',
        name: 'Email',
        userId: null,
        organizationId: null,
        emailAddress: 'team@example.com',
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
      },
      {
        id: 'target-dingtalk',
        type: 'DINGTALK_ROBOT',
        name: 'DingTalk',
        userId: null,
        organizationId: null,
        emailAddress: null,
        dingtalkWebhookUrl: 'https://oapi.dingtalk.com/robot/send',
        dingtalkSecret: null,
      },
    ]);
    sendEmail.mockResolvedValue({ messageId: 'msg-1' });
    sendDingTalkMarkdown.mockRejectedValue(new Error('bad robot'));

    await expect(
      createService().sendBriefing({
        id: 'briefing-1',
        workspaceId: 'workspace-1',
        date: new Date('2026-06-03T00:00:00.000Z'),
        markdownContent: '# Briefing',
        htmlContent: '<h1>Briefing</h1>',
      }),
    ).resolves.toEqual({ successCount: 1, targetCount: 2 });

    expect(logCreate).toHaveBeenCalledTimes(2);
    expect(logCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        briefingId: 'briefing-1',
        deliveryTargetId: 'target-email',
        status: 'SUCCESS',
      },
    });
    expect(logCreate.mock.calls[1]?.[0]).toMatchObject({
      data: {
        briefingId: 'briefing-1',
        deliveryTargetId: 'target-dingtalk',
        status: 'FAILED',
        errorMessage: 'bad robot',
      },
    });
    expect(briefingUpdate).toHaveBeenCalledWith({
      where: { id: 'briefing-1' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('sends a briefing through DingTalk app work notifications', async () => {
    targetFindMany.mockResolvedValue([
      {
        id: 'target-app',
        type: 'DINGTALK_APP',
        name: 'Bob',
        userId: 'user-bob',
        organizationId: 'org-1',
        emailAddress: null,
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
      },
    ]);
    organizationFindUnique.mockResolvedValue({
      providerOrganizationId: 'corp-1',
    });
    sendPersonalMarkdown.mockResolvedValue({ errcode: 0, task_id: 123 });

    await expect(
      createService({ dingTalkNotification: { sendPersonalMarkdown } }).sendBriefing({
        id: 'briefing-1',
        workspaceId: 'workspace-1',
        date: new Date('2026-06-03T00:00:00.000Z'),
        markdownContent: '# Briefing',
        htmlContent: '<h1>Briefing</h1>',
      }),
    ).resolves.toEqual({ successCount: 1, targetCount: 1 });

    expect(sendPersonalMarkdown).toHaveBeenCalledWith({
      flowxUserId: 'user-bob',
      corpId: 'corp-1',
      title: 'Daily Briefing 2026-06-03',
      markdown: '# Briefing',
    });
  });
});
