import { describe, expect, it, vi } from 'vitest';
import { WorkItemsService } from './work-items.service';

function workItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'work-item-1',
    displayCode: 'REQ-001',
    status: 'ACTIVE',
    title: '统一登录',
    ownerUserId: 'user-1',
    ownerUser: { id: 'user-1', displayName: '张三', avatarUrl: null },
    projectId: 'project-1',
    project: {
      id: 'project-1',
      name: 'FlowX',
      workspace: {
        organizationId: 'org-1',
        organization: { providerOrganizationId: 'corp-1' },
      },
    },
    versionId: 'version-1',
    ...overrides,
  };
}

function createService(existing: Record<string, unknown>, updated: Record<string, unknown>) {
  const prisma = {
    workItem: {
      findUnique: vi.fn().mockResolvedValue(existing),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
    },
    userOrganization: {
      findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }),
    },
  };
  const notificationService = {
    sendWorkItemChangeMarkdown: vi.fn().mockResolvedValue(undefined),
  };
  const service = new WorkItemsService(
    prisma as never,
    {} as never,
    undefined,
    undefined,
    notificationService as never,
  );
  return { service, prisma, notificationService };
}

const auth = {
  user: { id: 'actor-1', displayName: '产品甲' },
  organization: { id: 'org-1' },
};

async function flushNotification() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('WorkItemsService work item change notifications', () => {
  it('负责人从 A 改为 B 时异步通知 B', async () => {
    const existing = workItem();
    const updated = workItem({
      ownerUserId: 'user-2',
      ownerUser: { id: 'user-2', displayName: '李四', avatarUrl: null },
    });
    const { service, notificationService } = createService(existing, updated);

    await service.update('work-item-1', { ownerUserId: 'user-2' }, auth);
    await flushNotification();

    expect(notificationService.sendWorkItemChangeMarkdown).toHaveBeenCalledWith(expect.objectContaining({
      recipient: expect.objectContaining({ flowxUserId: 'user-2', displayName: '李四' }),
      ownerChange: { from: '张三', to: '李四' },
    }));
  });

  it('负责人清空时不发送负责人通知', async () => {
    const { service, notificationService } = createService(
      workItem(),
      workItem({ ownerUserId: null, ownerUser: null }),
    );

    await service.update('work-item-1', { ownerUserId: null }, auth);
    await flushNotification();

    expect(notificationService.sendWorkItemChangeMarkdown).not.toHaveBeenCalled();
  });

  it('任意状态变化通知更新后的负责人', async () => {
    const { service, notificationService } = createService(
      workItem(),
      workItem({ status: 'CUSTOM_STATUS' }),
    );

    await service.update('work-item-1', { status: 'CUSTOM_STATUS' }, auth);
    await flushNotification();

    expect(notificationService.sendWorkItemChangeMarkdown).toHaveBeenCalledWith(expect.objectContaining({
      recipient: expect.objectContaining({ flowxUserId: 'user-1', displayName: '张三' }),
      statusChange: { from: 'ACTIVE', to: 'CUSTOM_STATUS' },
    }));
  });

  it('同时修改负责人和状态时同一接收人只发送一次且合并两种变化', async () => {
    const { service, notificationService } = createService(
      workItem(),
      workItem({
        ownerUserId: 'user-2',
        ownerUser: { id: 'user-2', displayName: '李四', avatarUrl: null },
        status: 'CLOSED',
      }),
    );

    await service.update('work-item-1', { ownerUserId: 'user-2', status: 'CLOSED' }, auth);
    await flushNotification();

    expect(notificationService.sendWorkItemChangeMarkdown).toHaveBeenCalledTimes(1);
    expect(notificationService.sendWorkItemChangeMarkdown).toHaveBeenCalledWith(expect.objectContaining({
      ownerChange: { from: '张三', to: '李四' },
      statusChange: { from: 'ACTIVE', to: 'CLOSED' },
    }));
  });

  it('无负责人时状态变化不发送，发送异常也不阻塞 update', async () => {
    const { service, notificationService, prisma } = createService(
      workItem(),
      workItem({ ownerUserId: null, ownerUser: null, status: 'CLOSED' }),
    );
    notificationService.sendWorkItemChangeMarkdown.mockRejectedValue(new Error('network unavailable'));

    await expect(service.update('work-item-1', { status: 'CLOSED', ownerUserId: null }, auth)).resolves.toEqual(expect.objectContaining({ status: 'CLOSED' }));
    await flushNotification();

    expect(prisma.workItem.updateMany).toHaveBeenCalledTimes(1);
    expect(notificationService.sendWorkItemChangeMarkdown).not.toHaveBeenCalled();
  });

  it('负责人和状态未发生实际变化时不发送', async () => {
    const { service, notificationService } = createService(workItem(), workItem());

    await service.update('work-item-1', { ownerUserId: 'user-1', status: 'ACTIVE' }, auth);
    await flushNotification();

    expect(notificationService.sendWorkItemChangeMarkdown).not.toHaveBeenCalled();
  });
});
