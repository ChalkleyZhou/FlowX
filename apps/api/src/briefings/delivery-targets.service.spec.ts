import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryTargetsService } from './delivery-targets.service';

describe('DeliveryTargetsService', () => {
  const targetFindMany = vi.fn();
  const targetFindUnique = vi.fn();
  const targetCreate = vi.fn();
  const targetUpdate = vi.fn();
  const targetDelete = vi.fn();
  const logDeleteMany = vi.fn();
  const logCreate = vi.fn();
  const briefingUpdate = vi.fn();
  const dailyCodeReviewUpdate = vi.fn();
  const projectFindUnique = vi.fn();
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
    projectFindUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'workspace-1' });
  });

  function createService(options?: {
    authService?: { resolveOrganizationMemberEmail: ReturnType<typeof vi.fn> };
    dingTalkNotification?: { sendPersonalMarkdown: ReturnType<typeof vi.fn> };
  }) {
    return new DeliveryTargetsService(
      {
        deliveryTarget: {
          findMany: targetFindMany,
          findUnique: targetFindUnique,
          create: targetCreate,
          update: targetUpdate,
        },
        deliveryLog: { create: logCreate },
        briefing: { update: briefingUpdate },
        dailyCodeReview: { update: dailyCodeReviewUpdate },
        project: { findUnique: projectFindUnique },
        userOrganization: { findUnique: userOrganizationFindUnique },
        organization: { findUnique: organizationFindUnique },
        $transaction: transaction,
      } as never,
      { sendDingTalkMarkdown, sendEmail },
      options?.authService as never,
      options?.dingTalkNotification as never,
    );
  }

  it('creates project-scoped delivery targets', async () => {
    targetCreate.mockResolvedValue({ id: 'target-1' });

    await expect(
      createService().createTarget({
        projectId: 'project-1',
        type: 'EMAIL',
        name: 'Team',
        emailAddress: 'team@example.com',
      }),
    ).resolves.toEqual({ id: 'target-1' });

    expect(projectFindUnique).toHaveBeenCalledWith({ where: { id: 'project-1' } });
    expect(targetCreate).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        type: 'EMAIL',
        name: 'Team',
        userId: null,
        organizationId: null,
        emailAddress: 'team@example.com',
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
        isActive: true,
        forBriefing: true,
        forCodeReview: true,
      },
    });
  });

  it('allows creating a target scoped to a single delivery purpose', async () => {
    targetCreate.mockResolvedValue({ id: 'target-cr-only' });

    await createService().createTarget({
      projectId: 'project-1',
      type: 'EMAIL',
      name: 'CR only',
      emailAddress: 'cr@example.com',
      forBriefing: false,
      forCodeReview: true,
    });

    expect(targetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        forBriefing: false,
        forCodeReview: true,
      }),
    });
  });

  it('rejects creating a delivery target with both purposes disabled', async () => {
    await expect(
      createService().createTarget({
        projectId: 'project-1',
        type: 'EMAIL',
        name: 'Nowhere',
        emailAddress: 'nowhere@example.com',
        forBriefing: false,
        forCodeReview: false,
      }),
    ).rejects.toThrow('至少保留一个投递用途');

    expect(targetCreate).not.toHaveBeenCalled();
  });

  it('rejects updating a delivery target when both purposes would end up disabled', async () => {
    targetFindUnique.mockResolvedValue({
      id: 'target-1',
      forBriefing: true,
      forCodeReview: false,
    });

    await expect(
      createService().updateTarget('target-1', { forBriefing: false }),
    ).rejects.toThrow('至少保留一个投递用途');

    expect(targetUpdate).not.toHaveBeenCalled();
  });

  it('allows updating a single purpose flag when the other stays enabled', async () => {
    targetFindUnique.mockResolvedValue({
      id: 'target-1',
      forBriefing: true,
      forCodeReview: true,
    });
    targetUpdate.mockResolvedValue({ id: 'target-1' });

    await expect(
      createService().updateTarget('target-1', { forBriefing: false }),
    ).resolves.toEqual({ id: 'target-1' });

    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { forBriefing: false },
    });
  });

  it('lists targets for a workspace through project relation', async () => {
    targetFindMany.mockResolvedValue([]);

    await createService().listTargets({ workspaceId: 'workspace-1' });

    expect(targetFindMany).toHaveBeenCalledWith({
      where: { project: { workspaceId: 'workspace-1' } },
      orderBy: { createdAt: 'desc' },
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
          projectId: 'project-1',
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
        projectId: 'project-1',
        type: 'EMAIL',
        name: 'Bob',
        userId: null,
        organizationId: null,
        emailAddress: 'bob@company.com',
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
        isActive: true,
        forBriefing: true,
        forCodeReview: true,
      },
    });
  });

  it('creates DingTalk app delivery targets bound to organization members', async () => {
    userOrganizationFindUnique.mockResolvedValue({ userId: 'user-bob' });
    targetCreate.mockResolvedValue({ id: 'target-app' });

    await expect(
      createService().createTarget(
        {
          projectId: 'project-1',
          type: 'DINGTALK_APP',
          name: 'Bob',
          userId: 'user-bob',
        },
        'org-1',
      ),
    ).resolves.toEqual({ id: 'target-app' });

    expect(targetCreate).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        type: 'DINGTALK_APP',
        name: 'Bob',
        userId: 'user-bob',
        organizationId: 'org-1',
        emailAddress: null,
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
        isActive: true,
        forBriefing: true,
        forCodeReview: true,
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

  it('sends a briefing only to active targets for the briefing project', async () => {
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
        projectId: 'project-1',
        projectName: '信息化系统',
        date: new Date('2026-06-03T00:00:00.000Z'),
        markdownContent: '# Briefing',
        htmlContent: '<h1>Briefing</h1>',
      }),
    ).resolves.toEqual({ successCount: 1, targetCount: 2 });

    expect(targetFindMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', isActive: true, forBriefing: true },
      orderBy: { createdAt: 'asc' },
    });
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
      data: { sentAt: expect.any(Date), errorMessage: null },
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
        projectId: 'project-1',
        projectName: '信息化系统',
        date: new Date('2026-06-03T00:00:00.000Z'),
        markdownContent: '# Briefing',
        htmlContent: '<h1>Briefing</h1>',
      }),
    ).resolves.toEqual({ successCount: 1, targetCount: 1 });

    expect(sendPersonalMarkdown).toHaveBeenCalledWith({
      flowxUserId: 'user-bob',
      corpId: 'corp-1',
      title: '信息化系统 · 项目变化简报 · 2026-06-03',
      markdown: '# Briefing',
    });
  });

  it('sendBriefing only queries active targets with forBriefing enabled', async () => {
    targetFindMany.mockResolvedValue([
      {
        id: 'target-briefing-only',
        type: 'EMAIL',
        name: 'Briefing only',
        userId: null,
        organizationId: null,
        emailAddress: 'briefing@example.com',
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
      },
    ]);
    sendEmail.mockResolvedValue({ messageId: 'msg-briefing' });

    const result = await createService().sendBriefing({
      id: 'briefing-1',
      projectId: 'project-1',
      projectName: '信息化系统',
      date: new Date('2026-06-03T00:00:00.000Z'),
      markdownContent: '# Briefing',
      htmlContent: '<h1>Briefing</h1>',
    });

    expect(result.targetCount).toBe(1);
    expect(targetFindMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', isActive: true, forBriefing: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('sendDailyCodeReview only queries active targets with forCodeReview enabled', async () => {
    targetFindMany.mockResolvedValue([
      {
        id: 'target-cr-only',
        type: 'EMAIL',
        name: 'Code review only',
        userId: null,
        organizationId: null,
        emailAddress: 'cr@example.com',
        dingtalkWebhookUrl: null,
        dingtalkSecret: null,
      },
    ]);
    sendEmail.mockResolvedValue({ messageId: 'msg-cr' });
    dailyCodeReviewUpdate.mockResolvedValue({ id: 'review-1' });

    const result = await createService().sendDailyCodeReview({
      id: 'review-1',
      projectId: 'project-1',
      projectName: '信息化系统',
      date: new Date('2026-06-03T00:00:00.000Z'),
      markdownContent: '# 代码审查',
      htmlContent: '<h1>代码审查</h1>',
    });

    expect(result.targetCount).toBe(1);
    expect(targetFindMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', isActive: true, forCodeReview: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(dailyCodeReviewUpdate).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: { sentAt: expect.any(Date), errorMessage: null },
    });
  });
});
