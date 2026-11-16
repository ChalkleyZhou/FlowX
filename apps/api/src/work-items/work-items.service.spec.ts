import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkItemsService } from './work-items.service';

function createService(item: Record<string, unknown>) {
  const executionSession = {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'session-1' }),
    update: vi.fn().mockResolvedValue({}),
  };
  const stageExecution = { findFirst: vi.fn().mockResolvedValue({ id: 'stage-1' }) };
  const prisma = {
    executionItem: {
      findUnique: vi.fn().mockResolvedValue(item),
      findUniqueOrThrow: vi.fn().mockResolvedValue(item),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    executionSession,
    stageExecution,
    userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
  };
  (prisma as typeof prisma & { $transaction: (callback: (tx: typeof prisma) => Promise<unknown>) => Promise<unknown> }).$transaction = async (callback) => callback(prisma);
  const workflowService = { advanceExecutionPlanIfComplete: vi.fn().mockResolvedValue(null) };
  return { service: new WorkItemsService(prisma as never, workflowService as never), prisma, workflowService };
}

function executionItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'execution-item-1',
    status: 'READY',
    ownerUserId: 'user-1',
    claimKey: null,
    dependsOnIds: [],
    executionPlan: {
      status: 'CONFIRMED',
      workflowRunId: 'workflow-1',
      workItem: { projectId: 'project-1', project: { workspaceId: 'workspace-1', workspace: { organizationId: 'org-1' } } },
    },
    ...overrides,
  };
}

describe('WorkItemsService execution item lifecycle', () => {
  it('allows the assigned owner to claim a confirmed plan item', async () => {
    const { service, prisma } = createService(executionItem());

    await service.claimExecutionItem('execution-item-1', { userId: 'user-1', claimKey: 'claim-1' });

    expect(prisma.executionItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ ownerUserId: null }, { ownerUserId: 'user-1' }] }),
    }));
  });

  it('rejects a different user when the item has a designated owner', async () => {
    const { service, prisma } = createService(executionItem());

    await expect(service.claimExecutionItem('execution-item-1', { userId: 'user-2', claimKey: 'claim-2' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.executionItem.updateMany).not.toHaveBeenCalled();
  });

  it('creates an execution session bound to the item when a local agent claims it', async () => {
    const item = executionItem();
    const executionSession = {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'session-1' }),
      update: vi.fn().mockResolvedValue({}),
    };
    const stageExecution = { findFirst: vi.fn().mockResolvedValue({ id: 'stage-1' }) };
    const prisma = {
      executionItem: {
        findUnique: vi.fn().mockResolvedValue(item),
        findUniqueOrThrow: vi.fn().mockResolvedValue(item),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      executionSession,
      stageExecution,
      userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
    };
    (prisma as typeof prisma & { $transaction: (callback: (tx: typeof prisma) => Promise<unknown>) => Promise<unknown> }).$transaction = async (callback) => callback(prisma);
    const service = new WorkItemsService(prisma as never, { advanceExecutionPlanIfComplete: vi.fn() } as never);

    const result = await service.claimExecutionItem('execution-item-1', { userId: 'user-1', claimKey: 'claim-1' });

    expect(result).toEqual(expect.objectContaining({ executionSessionId: 'session-1' }));
    expect(executionSession.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ executionItemId: 'execution-item-1', stageExecutionId: 'stage-1' }) }));
  });

  it('rejects claim and completion before the plan is confirmed and started', async () => {
    const { service } = createService(executionItem({ executionPlan: {
      status: 'DRAFT',
      workflowRunId: null,
      workItem: { project: { workspace: { organizationId: 'org-1' } } },
    } }));

    await expect(service.claimExecutionItem('execution-item-1', { userId: 'user-1', claimKey: 'claim-1' }))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.completeExecutionItem('execution-item-1', { userId: 'user-1', claimKey: 'claim-1' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('stores completion evidence and is idempotent for the same claim key', async () => {
    const completed = executionItem({ status: 'IN_PROGRESS', claimKey: 'claim-1' });
    const { service, prisma, workflowService } = createService(completed);

    await service.completeExecutionItem('execution-item-1', {
      userId: 'user-1',
      claimKey: 'claim-1',
      summary: '端侧验证完成',
      evidence: { testCommand: 'pnpm test', passed: true },
    });

    expect(prisma.executionItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        completionSummary: '端侧验证完成',
        completionEvidence: { testCommand: 'pnpm test', passed: true },
      }),
    }));
    expect(workflowService.advanceExecutionPlanIfComplete).toHaveBeenCalledWith('workflow-1');

    prisma.executionItem.findUnique.mockResolvedValue({ ...completed, status: 'COMPLETED' });
    await expect(service.completeExecutionItem('execution-item-1', { userId: 'user-1', claimKey: 'claim-1' })).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED' }));
    expect(prisma.executionItem.updateMany).toHaveBeenCalledTimes(1);
  });

  it('requires the current owner to block an in-progress item', async () => {
    const { service, prisma } = createService(executionItem({ status: 'IN_PROGRESS', claimKey: 'claim-1' }));

    await expect(service.blockExecutionItem('execution-item-1', {
      userId: 'user-2',
      claimKey: 'claim-1',
      reason: '等待依赖服务',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.executionItem.updateMany).not.toHaveBeenCalled();
  });

  it('allows cancelling a ready item with a reason', async () => {
    const { service, prisma } = createService(executionItem());

    await service.cancelExecutionItem('execution-item-1', { userId: 'user-2', reason: '本版本取消' });

    expect(prisma.executionItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', cancelReason: '本版本取消' }),
    }));
  });

  it('does not allow claiming before dependencies complete', async () => {
    const { service, prisma } = createService(executionItem({ dependsOnIds: ['dependency-1'] }));
    prisma.executionItem.findMany.mockResolvedValue([{ id: 'dependency-1', status: 'IN_PROGRESS' }]);

    await expect(service.claimExecutionItem('execution-item-1', { userId: 'user-1', claimKey: 'claim-1' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.executionItem.updateMany).not.toHaveBeenCalled();
  });

  it('generates execution items from the AI sequence and keeps the plan in draft', async () => {
    const generatedPlan = {
      id: 'plan-1',
      status: 'DRAFT',
      items: [],
      workItemId: 'work-item-1',
    };
    const workItem = {
      id: 'work-item-1',
      title: '跨端登录',
      description: '支持 Web 和移动端登录',
      acceptanceCriteria: '两端均可登录',
      project: { workspace: { organizationId: 'org-1' } },
      executionPlans: [generatedPlan],
    };
    const createdItems = [
      { id: 'item-1' },
      { id: 'item-2' },
    ];
    const executionItemCreate = vi.fn()
      .mockResolvedValueOnce(createdItems[0])
      .mockResolvedValueOnce(createdItems[1]);
    const executionItemUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      workItem: { findUnique: vi.fn().mockResolvedValue(workItem) },
      executionPlan: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...generatedPlan, items: [
          { id: 'item-1', title: 'Web', status: 'READY' },
          { id: 'item-2', title: '移动端', status: 'READY' },
        ] }),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        executionItem: { create: executionItemCreate, update: executionItemUpdate },
        executionPlan: { findUniqueOrThrow: vi.fn().mockResolvedValue({ ...generatedPlan, items: [] }) },
      })),
    };
    const generateSpecPlan = vi.fn().mockResolvedValue({ plan: { sequence: ['Web 登录', '移动端登录', 'Web 登录'] } });
    const splitExecutionPlan = vi.fn().mockResolvedValue({ items: [
      { title: 'Web 登录', description: '实现 Web 登录', target: 'WEB', ownerHint: 'Web', required: true, dependsOnIndexes: [], verification: ['Web 登录测试通过'] },
      { title: '移动端登录', description: '实现移动端登录', target: 'MOBILE', ownerHint: '移动端', required: true, dependsOnIndexes: [0], verification: ['移动端登录测试通过'] },
    ] });
    const context = {
      resolveOnlineProvider: vi.fn().mockResolvedValue('codex'),
      resolveInvocationContext: vi.fn().mockResolvedValue({ codexApiKey: 'test' }),
    };
    const service = new WorkItemsService(
      prisma as never,
      {} as never,
      { get: vi.fn().mockReturnValue({ generateSpecPlan, splitExecutionPlan }) } as never,
      context as never,
    );

    await service.generateExecutionPlan('work-item-1', 'plan-1', {}, { user: { id: 'user-1' } });

    expect(generateSpecPlan).toHaveBeenCalledOnce();
    expect(splitExecutionPlan).toHaveBeenCalledOnce();
    expect(executionItemCreate).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ executionPlanId: 'plan-1', title: 'Web 登录', target: 'WEB', ownerHint: 'Web', status: 'READY', required: true, verification: 'Web 登录测试通过' }) });
    expect(executionItemUpdate).toHaveBeenCalledWith({ where: { id: 'item-2' }, data: { dependsOnIds: ['item-1'] } });
  });

  it('fails AI plan generation when the organization has no online AI credentials', async () => {
    const workItem = {
      id: 'work-item-1',
      title: '登录',
      description: 'desc',
      acceptanceCriteria: '',
      project: { workspace: { organizationId: 'org-1' } },
      executionPlans: [{ id: 'plan-1', status: 'DRAFT', items: [] }],
    };
    const service = new WorkItemsService(
      { workItem: { findUnique: vi.fn().mockResolvedValue(workItem) } } as never,
      {} as never,
      { get: vi.fn() } as never,
      { resolveOnlineProvider: vi.fn().mockRejectedValue(new BadRequestException('当前组织未配置 AI 凭据，在线 AI 不可用。')) } as never,
    );

    await expect(service.generateExecutionPlan('work-item-1', 'plan-1', {}, { user: { id: 'user-1' } }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('WorkItemsService work item paging and plan validation', () => {
  it('combines keyword filtering with a stable cursor instead of replacing one filter with the other', async () => {
    const updatedAt = new Date('2026-11-13T00:00:00.000Z');
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'project-1',
          workspaceId: 'workspace-1',
          currentVersionId: 'version-1',
          workspace: { organizationId: 'org-1', repositories: [] },
        }),
      },
      projectVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1' }) },
      workItem: { findMany },
    };
    const service = new WorkItemsService(prisma as never, {} as never);
    const cursor = Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id: 'item-9' }), 'utf8').toString('base64url');

    await service.listByVersion('project-1', 'version-1', { q: '登录', cursor, pageSize: 20 }, { organization: { id: 'org-1' } });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          { OR: [{ title: { contains: '登录' } }, { description: { contains: '登录' } }, { displayCode: { contains: '登录' } }] },
          { OR: [{ updatedAt: { lt: updatedAt } }, { updatedAt, id: { lt: 'item-9' } }] },
        ],
      }),
    }));
  });

  it('rejects cyclic execution dependencies before confirming a plan', async () => {
    const plan = {
      id: 'plan-1',
      status: 'DRAFT',
      items: [
        { id: 'item-a', title: 'A', required: true, dependsOnIds: ['item-b'] },
        { id: 'item-b', title: 'B', required: true, dependsOnIds: ['item-a'] },
      ],
    };
    const prisma = {
      workItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'work-item-1',
          project: { workspace: { organizationId: 'org-1' } },
          executionPlans: [plan],
        }),
      },
      executionPlan: { findFirst: vi.fn().mockResolvedValue(plan) },
    };
    const service = new WorkItemsService(prisma as never, {} as never);

    await expect(service.confirmPlan('work-item-1', 'plan-1', { organization: { id: 'org-1' } }))
      .rejects.toThrow('执行项依赖不能形成循环');
  });
});
