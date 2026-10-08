import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionControlService } from './execution-control.service';

const now = new Date('2026-09-30T08:00:00Z');
const scope = { organizationId: 'org-1', userId: 'user-1', organizationRole: 'member' };
function createHarness(overrides: Record<string, unknown> = {}) {
  const row = {
    id: 'session-1', workflowRunId: 'workflow-1', stageExecutionId: 'stage-1',
    organizationId: 'org-1', claimedByUserId: 'user-1', executorType: 'LOCAL', sourceTool: 'codex',
    deviceId: 'device-1', status: 'RUNNING', controlMode: 'COOPERATIVE',
    blockedReason: null, cancelRequestedAt: null, createdAt: now, startedAt: now,
    lastHeartbeatAt: now, updatedAt: now, commands: [],
    stageExecution: { stage: 'EXECUTION' }, workspace: { organizationId: 'org-1' },
    ...overrides,
  };
  const prisma = {
    executionSession: {
      findFirst: vi.fn().mockResolvedValue(row), findUnique: vi.fn().mockResolvedValue(row),
      findMany: vi.fn().mockResolvedValue([row]), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
    },
    executionCommand: {
      findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'command-1', ...data })),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  const workflow = { cancelLocalExecution: vi.fn().mockImplementation(async (_id, options) => {
    await options?.beforeCancel?.(prisma);
    return { id: 'workflow-1' };
  }) };
  return { row, prisma, workflow, service: new ExecutionControlService(prisma as never, workflow as never) };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe('执行控制', () => {
  it('列表必须带组织作用域，支持分页和筛选', async () => {
    const { service, prisma } = createHarness();
    await expect(service.list({}, {})).rejects.toBeInstanceOf(ForbiddenException);
    await service.list({ projectId: 'project-1', status: 'RUNNING', sourceTool: 'codex', take: 10 }, scope);
    expect(prisma.executionSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: 'project-1', status: 'RUNNING', sourceTool: 'codex',
        workspace: { organizationId: 'org-1' } }), take: 11,
    }));
  });

  it('同组织其他成员不能控制任务，管理员可以取消', async () => {
    const { service } = createHarness();
    await expect(service.request('session-1', { commandType: 'CANCEL', idempotencyKey: 'k' },
      { ...scope, userId: 'other' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.request('session-1', { commandType: 'CANCEL', idempotencyKey: 'k' },
      { ...scope, userId: 'admin', organizationRole: 'admin' })).resolves.toMatchObject({ commandType: 'CANCEL' });
  });

  it('取消请求立即封锁完成入口，但必须等待本地回执才取消工作流', async () => {
    const { service, prisma, workflow } = createHarness();
    await service.request('session-1', { commandType: 'CANCEL', idempotencyKey: 'k' }, scope);
    expect(prisma.executionSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cancelRequestedAt: now }),
    }));
    expect(workflow.cancelLocalExecution).not.toHaveBeenCalled();
  });

  it('相同命令键返回原命令，换类型不能复用', async () => {
    const { service, prisma } = createHarness();
    const command = { id: 'c1', executionSessionId: 'session-1', commandType: 'CANCEL', status: 'ACKED', idempotencyKey: 'k' };
    prisma.executionCommand.findUnique.mockResolvedValue(command);
    await expect(service.request('session-1', { commandType: 'CANCEL', idempotencyKey: 'k' }, scope)).resolves.toBe(command);
    await expect(service.request('session-1', { commandType: 'RESUME', idempotencyKey: 'k' }, scope)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.executionCommand.create).not.toHaveBeenCalled();
  });

  it('离线和终态不会因恢复命令自动变回运行', async () => {
    const { service } = createHarness({ status: 'COMPLETED' });
    await expect(service.request('session-1', { commandType: 'RESUME', idempotencyKey: 'k' }, scope)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('只允许已绑定执行人和设备获取或回执命令', async () => {
    const { service } = createHarness();
    await expect(service.checkpoint('session-1', { deviceId: 'device-2' }, scope)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.checkpoint('session-1', { deviceId: 'device-1' }, { ...scope, userId: 'other' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('频繁检查点仍返回命令，但不频繁写心跳', async () => {
    const { service, prisma } = createHarness();
    const result = await service.checkpoint('session-1', { deviceId: 'device-1' }, scope);
    expect(prisma.executionSession.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ heartbeatIntervalMs: 30_000, commands: [] });
  });

  it('取消回执与工作流恢复待执行在同一事务提交', async () => {
    const { service, prisma, workflow } = createHarness({ cancelRequestedAt: now });
    prisma.executionCommand.findUnique.mockResolvedValue({
      id: 'c1', executionSessionId: 'session-1', commandType: 'CANCEL', status: 'DELIVERED', expiresAt: null,
    });
    await service.acknowledge('session-1', 'c1', { deviceId: 'device-1', outcome: 'ACKED' }, scope);
    expect(workflow.cancelLocalExecution).toHaveBeenCalledWith('workflow-1', expect.objectContaining({ expectedSessionId: 'session-1' }));
    expect(prisma.executionCommand.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'c1' }), data: expect.objectContaining({ status: 'ACKED' }),
    }));
  });

  it('取消失败保留完成封锁，且不声称 Agent 已停止', async () => {
    const { service, prisma, workflow } = createHarness({ cancelRequestedAt: now });
    prisma.executionCommand.findUnique.mockResolvedValue({ id: 'c1', executionSessionId: 'session-1', commandType: 'CANCEL', status: 'DELIVERED' });
    await service.acknowledge('session-1', 'c1', { deviceId: 'device-1', outcome: 'FAILED', message: '本地操作未停止' }, scope);
    expect(workflow.cancelLocalExecution).not.toHaveBeenCalled();
    expect(prisma.executionSession.updateMany).not.toHaveBeenCalled();
  });
});

describe('重新交接', () => {
  it('未确认本地停止不能重新交接', async () => {
    const { service } = createHarness();
    await expect(service.retry('session-1', { previousExecutionStopped: false, sourceTool: 'codex' } as never, scope)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('相同重试返回已经创建的会话，不再次领取', async () => {
    const { service, prisma, workflow } = createHarness({ status: 'CANCELLED' });
    prisma.executionSession.findUnique.mockResolvedValue({ id: 'retry-session', workflowRunId: 'workflow-1' });
    await expect(service.retry('session-1', { previousExecutionStopped: true, sourceTool: 'codex' }, scope)).resolves.toMatchObject({ executionSessionId: 'retry-session' });
    expect(workflow.cancelLocalExecution).not.toHaveBeenCalled();
  });
});
