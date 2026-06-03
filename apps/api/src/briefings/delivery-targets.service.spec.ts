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
  const transaction = vi.fn((callback) =>
    callback({
      deliveryLog: { deleteMany: logDeleteMany },
      deliveryTarget: { delete: targetDelete },
    }),
  );
  const sendDingTalkMarkdown = vi.fn();
  const sendEmail = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new DeliveryTargetsService(
      {
        deliveryTarget: {
          findMany: targetFindMany,
          create: targetCreate,
          update: targetUpdate,
        },
        deliveryLog: { create: logCreate },
        briefing: { update: briefingUpdate },
        $transaction: transaction,
      } as never,
      { sendDingTalkMarkdown, sendEmail },
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
        emailAddress: 'team@example.com',
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
        emailAddress: 'team@example.com',
      },
      {
        id: 'target-dingtalk',
        type: 'DINGTALK_ROBOT',
        name: 'DingTalk',
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
});

