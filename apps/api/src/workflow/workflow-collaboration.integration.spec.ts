import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkflowService } from './workflow.service';
import { WorkflowCollaborationService } from './workflow-collaboration.service';
import { WorkflowStateMachine } from '../common/workflow-state-machine';

const directory = mkdtempSync(join(tmpdir(), 'flowx-collaboration-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const service = new WorkflowService(prisma as never, new WorkflowStateMachine(), {} as never,
  {} as never, {} as never, {} as never, {} as never, {} as never);
const collaboration = new WorkflowCollaborationService(prisma as never, new WorkflowStateMachine());
let orgId: string;
let workspaceId: string;
let projectId: string;
let userA: string;
let userB: string;

beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  orgId = (await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: randomUUID(), name: '协同测试组织' } })).id;
  userA = (await prisma.user.create({ data: { displayName: '甲' } })).id;
  userB = (await prisma.user.create({ data: { displayName: '乙' } })).id;
  workspaceId = (await prisma.workspace.create({ data: { name: '协同空间', organizationId: orgId } })).id;
  projectId = (await prisma.project.create({ data: { name: '协同项目', workspaceId } })).id;
}, 30_000);

afterAll(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

async function pending(stage = 'DESIGN') {
  const requirement = await prisma.requirement.create({ data: {
    title: '多角色接续', description: '', acceptanceCriteria: '', workspaceId, projectId,
  } });
  const run = await prisma.workflowRun.create({ data: { requirementId: requirement.id, status: `${stage}_PENDING`, currentStage: stage } });
  await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage, status: 'PENDING' } });
  return run;
}

function actor(userId: string) { return { user: { id: userId, displayName: userId === userA ? '甲' : '乙' }, organization: { id: orgId } }; }

describe('端云协同真实 SQLite 链路', () => {
  it.each(['Design', 'Brainstorm', 'SpecPlan'] as const)('并发领取 %s 只生成一份有效会话，竞争方收到业务冲突', async (kind) => {
    const run = await pending(kind === 'Brainstorm' ? 'BRAINSTORM' : kind === 'SpecPlan' ? 'SPEC_PLAN' : 'DESIGN');
    const results = await Promise.allSettled([
      service[`claimLocal${kind}`](run.id, actor(userA)),
      service[`claimLocal${kind}`](run.id, actor(userB)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason.getStatus?.()).toBe(409);
    expect(await prisma.executionSession.count({ where: { workflowRunId: run.id, status: 'RUNNING' } })).toBe(1);
  });
  it.each(['Design', 'Brainstorm', 'SpecPlan'] as const)('%s 明确释放后换人新尝试，旧回传被拒绝，重复释放不影响新任务', async (kind) => {
    const run = await pending(kind === 'Brainstorm' ? 'BRAINSTORM' : kind === 'SpecPlan' ? 'SPEC_PLAN' : 'DESIGN');
    const first = await service[`claimLocal${kind}`](run.id, actor(userA));
    expect((await service[`claimLocal${kind}`](run.id, actor(userA))).handoff.executionSessionId).toBe(first.handoff.executionSessionId);
    const before = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    const view = await collaboration.getCollaboration(run.id, actor(userB));
    expect(view.sessions).toMatchObject([{ claimedByUser: { displayName: '甲' }, isOwner: false, canRelease: false, health: 'UNKNOWN' }]);
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).updatedAt).toEqual(before.updatedAt);
    const release = { executionSessionId: first.handoff.executionSessionId, confirmedStopped: true as const, reason: '已在甲设备停止' };
    await expect(collaboration.releaseLocalTask(run.id, release, actor(userB))).rejects.toMatchObject({ status: 403 });
    await collaboration.releaseLocalTask(run.id, release, actor(userA));
    if (kind === 'Design') {
      await expect(service.submitLocalDesign(run.id, {}, actor(userA))).rejects.toMatchObject({ status: 409 });
    }
    const second = await service[`claimLocal${kind}`](run.id, actor(userB));
    expect(second.handoff.executionSessionId).not.toBe(first.handoff.executionSessionId);
    const stage = await prisma.stageExecution.findFirstOrThrow({ where: { workflowRunId: run.id, stage: run.currentStage! }, orderBy: { attempt: 'desc' } });
    expect(stage).toMatchObject({ attempt: 2, status: 'RUNNING' });
    await collaboration.releaseLocalTask(run.id, release, actor(userA));
    expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: second.handoff.executionSessionId } })).status).toBe('RUNNING');
    await expect(service[`completeLocal${kind}Session`](first.handoff.executionSessionId, {} as never, { userId: userA, organizationId: orgId })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.syncEvent.count({ where: { executionSessionId: first.handoff.executionSessionId } })).toBe(1);
    expect(await prisma.executionSession.count({ where: { workflowRunId: run.id, status: 'RUNNING' } })).toBe(1);
  });

  it('原执行人构思回传幂等，新产物只写入一次并接续设计', async () => {
    const run = await pending('BRAINSTORM');
    const { handoff } = await service.claimLocalBrainstorm(run.id, actor(userA));
    const report = { idempotencyKey: 'brainstorm-result', markdown: '# 登录优化\n\n验收：保持会话。', summary: '构思已完成' };
    const scope = { userId: userA, organizationId: orgId };
    await expect(service.completeLocalBrainstormSession(handoff.executionSessionId, report, { ...scope, userId: userB })).rejects.toMatchObject({ status: 403 });
    await service.completeLocalBrainstormSession(handoff.executionSessionId, report, scope);
    await service.completeLocalBrainstormSession(handoff.executionSessionId, report, scope);
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('DESIGN_PENDING');
    expect(await prisma.evidence.count({ where: { executionSessionId: handoff.executionSessionId } })).toBe(1);
    expect(await prisma.stageExecution.count({ where: { workflowRunId: run.id, stage: 'DESIGN' } })).toBe(1);
  });

  it('回传和释放并发时只有一个结果提交，失败方整体回滚', async () => {
    const run = await pending('BRAINSTORM');
    const { handoff } = await service.claimLocalBrainstorm(run.id, actor(userA));
    const results = await Promise.allSettled([
      collaboration.releaseLocalTask(run.id, { executionSessionId: handoff.executionSessionId, confirmedStopped: true, reason: '原设备已停止' }, actor(userA)),
      service.completeLocalBrainstormSession(handoff.executionSessionId, { idempotencyKey: 'race', markdown: '# 已完成' }, { userId: userA, organizationId: orgId }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const session = await prisma.executionSession.findUniqueOrThrow({ where: { id: handoff.executionSessionId } });
    const current = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    const stage = await prisma.stageExecution.findUniqueOrThrow({ where: { id: session.stageExecutionId! } });
    if (session.status === 'CANCELLED') {
      expect(stage.status).toBe('FAILED');
      expect(current.status).toBe('BRAINSTORM_PENDING');
      expect(await prisma.evidence.count({ where: { executionSessionId: session.id } })).toBe(0);
    } else {
      expect(session.status).toBe('COMPLETED');
      expect(stage.status).toBe('COMPLETED');
      expect(current.status).toBe('DESIGN_PENDING');
      expect(await prisma.syncEvent.count({ where: { executionSessionId: session.id } })).toBe(0);
    }
  });

});
