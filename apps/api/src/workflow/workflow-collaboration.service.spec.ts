import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowCollaborationService } from './workflow-collaboration.service';

const now = new Date('2026-10-22T06:00:00Z');
const actor = { user: { id: 'owner', displayName: '执行人' }, organization: { id: 'org' } };
const input = { executionSessionId: 'session', confirmedStopped: true as const, reason: ' 原设备已停止 ' };
function session(overrides: Record<string, unknown> = {}) {
  return { id: 'session', workflowRunId: 'run', stageExecutionId: 'stage', organizationId: 'org', workspaceId: 'space',
    executorType: 'LOCAL', status: 'RUNNING', sourceTool: 'codex', controlMode: 'NONE', claimedByUserId: 'owner',
    claimedByUser: { displayName: '执行人' }, lastHeartbeatAt: now, deviceId: null, summary: null,
    blockedReason: null, errorMessage: null, protocolVersion: '1.0', traceId: 'trace', updatedAt: now, ...overrides };
}
function stage(overrides: Record<string, unknown> = {}) {
  return { id: 'stage', workflowRunId: 'run', stage: 'DESIGN', status: 'RUNNING', attempt: 2, createdAt: now,
    executionSessions: [session()], ...overrides };
}
function workflow(overrides: Record<string, unknown> = {}) {
  return { id: 'run', status: 'DESIGN_PENDING', currentStage: 'DESIGN', updatedAt: now,
    requirement: { workspace: { id: 'space', organizationId: 'org' } }, stageExecutions: [stage()], ...overrides };
}
function harness(run = workflow(), target = session()) {
  const prisma = {
    workflowRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    executionSession: { findUnique: vi.fn().mockResolvedValue(target), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    stageExecution: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    syncEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    userOrganization: { findUnique: vi.fn().mockResolvedValue({ role: 'member' }) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  const machine = new WorkflowStateMachine();
  return { prisma, machine, service: new WorkflowCollaborationService(prisma as never, machine) };
}

describe('工作流协同状态与本地任务交接', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('查询只返回每阶段最新尝试的本地会话，不把领取心跳当作已运行', async () => {
    const { service, prisma } = harness(workflow({ stageExecutions: [
      stage({ attempt: 1, id: 'old', executionSessions: [session({ id: 'old-session' })] }),
      stage(), stage({ id: 'cloud', stage: 'BRAINSTORM', executionSessions: [session({ executorType: 'CLOUD' })] }),
    ] }));
    expect(await service.getCollaboration('run', actor)).toEqual({ workflowRunId: 'run', currentStage: 'DESIGN', sessions: [
      expect.objectContaining({ id: 'session', health: 'UNKNOWN', isOwner: true, canRelease: true,
        lastHeartbeatAt: now.toISOString(), claimedByUser: { displayName: '执行人' } }),
    ] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.workflowRun.updateMany).not.toHaveBeenCalled();
    expect(prisma.executionSession.updateMany).not.toHaveBeenCalled();
  });

  it('最新尝试没有会话时不回退到历史会话', async () => {
    const { service } = harness(workflow({ stageExecutions: [stage({ attempt: 1 }), stage({ attempt: 2, executionSessions: [] })] }));
    expect((await service.getCollaboration('run', actor)).sessions).toEqual([]);
  });

  it('COOPERATIVE 会话使用协议健康度且不允许显式释放', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { service } = harness(workflow({ stageExecutions: [stage({ executionSessions: [session({ controlMode: 'COOPERATIVE' })] })] }));
    expect((await service.getCollaboration('run', actor)).sessions[0]).toMatchObject({ health: 'ONLINE', canRelease: false });
  });

  it('跨组织查询按实际工作区组织拒绝，即使会话组织伪装为当前组织', async () => {
    const { service } = harness(workflow({ requirement: { workspace: { id: 'space', organizationId: 'other' } } }));
    await expect(service.getCollaboration('run', actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('旧需求缺少直接 workspace 时使用所属项目的工作区验证组织与会话', async () => {
    const { service } = harness(workflow({ requirement: { workspace: null, project: { workspace: { id: 'space', organizationId: 'org' } } } }));
    expect((await service.getCollaboration('run', actor)).sessions[0]).toMatchObject({ canRelease: true });
    await expect(service.releaseLocalTask('run', input, actor)).resolves.toMatchObject({ released: true });
  });

  it('项目回退工作区属于其他组织时拒绝读取', async () => {
    const { service } = harness(workflow({ requirement: { workspace: null, project: { workspace: { id: 'space', organizationId: 'other' } } } }));
    await expect(service.getCollaboration('run', actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('其他成员可见执行人但不能释放', async () => {
    const { service } = harness();
    expect((await service.getCollaboration('run', { ...actor, user: { id: 'other', displayName: '乙' } })).sessions[0])
      .toMatchObject({ isOwner: false, canRelease: false });
  });

  it('原执行人确认停止后，在同一事务取消会话、失败尝试并审计', async () => {
    const { service, prisma, machine } = harness();
    const assertion = vi.spyOn(machine, 'assertStageTransition');
    expect(await service.releaseLocalTask('run', input, actor)).toMatchObject({ executionSessionId: 'session', released: true });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.workflowRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'run', updatedAt: now }), data: { updatedAt: expect.any(Date) },
    }));
    expect(prisma.workflowRun.updateMany.mock.calls[0][0].data.updatedAt.getTime()).toBeGreaterThan(now.getTime());
    expect(assertion).toHaveBeenCalledWith('running', 'failed');
    expect(prisma.executionSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', activeControlDeviceKey: null, completedAt: expect.any(Date), summary: expect.stringContaining('原设备已停止') }),
    }));
    expect(prisma.stageExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', finishedAt: expect.any(Date) }) }));
    expect(prisma.syncEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 'owner', idempotencyKey: 'local-task-release:session',
      payload: expect.objectContaining({ reason: '原设备已停止', confirmedStopped: true, workflowRunId: 'run' }) }) });
    expect(prisma.workflowRun.findUnique).toHaveBeenCalledTimes(2);
  });

  it.each(['admin', 'sub_admin'])('组织 %s 可以释放历史无主会话', async (role) => {
    const target = session({ claimedByUserId: null, claimedByUser: null });
    const { service, prisma } = harness(workflow({ stageExecutions: [stage({ executionSessions: [target] })] }), target);
    prisma.userOrganization.findUnique.mockResolvedValue({ role });
    await expect(service.releaseLocalTask('run', input, actor)).resolves.toMatchObject({ released: true });
  });

  it.each([
    ['其他领取人', session({ claimedByUserId: 'other' })], ['历史无主会话', session({ claimedByUserId: null })],
    ['跨组织会话', session({ organizationId: 'other' })], ['跨空间会话', session({ workspaceId: 'other' })],
  ])('拒绝释放%s', async (_, target) => {
    const { service, prisma } = harness(workflow({ stageExecutions: [stage({ executionSessions: [target] })] }), target);
    await expect(service.releaseLocalTask('run', input, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.executionSession.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['COOPERATIVE', session({ controlMode: 'COOPERATIVE' }), workflow()],
    ['终态', session({ status: 'COMPLETED' }), workflow()],
    ['开发阶段', session(), workflow({ currentStage: 'EXECUTION', status: 'EXECUTION_RUNNING' })],
    ['待确认', session(), workflow({ status: 'DESIGN_WAITING_CONFIRMATION' })],
    ['历史尝试', session({ stageExecutionId: 'old-stage' }), workflow()],
    ['结束的工作流', session(), workflow({ status: 'DONE' })],
  ])('拒绝释放%s任务', async (_, target, run) => {
    const { service, prisma } = harness(run, target);
    await expect(service.releaseLocalTask('run', input, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.executionSession.updateMany).not.toHaveBeenCalled();
  });

  it.each([{ ...input, confirmedStopped: false }, { ...input, reason: '   ' }, { ...input, reason: 'a'.repeat(2001) }])('服务层同样要求确认停止且理由有效', async (body) => {
    const { service, prisma } = harness();
    await expect(service.releaseLocalTask('run', body as typeof input, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('重复释放返回幂等成功，后续尝试不受影响', async () => {
    const { service, prisma } = harness(workflow({ currentStage: 'SPEC_PLAN', status: 'SPEC_PLAN_PENDING' }), session({ status: 'CANCELLED' }));
    prisma.syncEvent.findUnique.mockResolvedValue({ executionSessionId: 'session', eventType: 'execution.local_task_released' } as never);
    await expect(service.releaseLocalTask('run', input, actor)).resolves.toMatchObject({ released: true });
    expect(prisma.workflowRun.updateMany).not.toHaveBeenCalled();
    expect(prisma.stageExecution.updateMany).not.toHaveBeenCalled();
    expect(prisma.syncEvent.create).not.toHaveBeenCalled();
  });

  it('工作流锁竞争返回 409 且不改动会话', async () => {
    const { service, prisma } = harness();
    prisma.workflowRun.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.releaseLocalTask('run', input, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.executionSession.updateMany).not.toHaveBeenCalled();
  });

  it('取得锁后重新核对最新尝试，不释放已被后续尝试取代的会话', async () => {
    const { service, prisma } = harness();
    prisma.workflowRun.findUnique.mockResolvedValueOnce(workflow()).mockResolvedValueOnce(workflow({ stageExecutions: [stage({ id: 'new-stage', attempt: 3 })] }));
    await expect(service.releaseLocalTask('run', input, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.executionSession.updateMany).not.toHaveBeenCalled();
  });

  it.each(['P2002', 'P2028', 'P2034', 'P1008'])('数据库竞争 %s 转为可恢复业务冲突', async (code) => {
    const { service, prisma } = harness();
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('transaction race', { code, clientVersion: '6' }));
    await expect(service.releaseLocalTask('run', input, actor)).rejects.toBeInstanceOf(ConflictException);
  });
});
