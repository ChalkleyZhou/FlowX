import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowService } from '../workflow/workflow.service';
import { ExecutionControlService } from './execution-control.service';
import { ExecutionSessionsService } from './execution-sessions.service';
import { SyncEventsService } from './sync-events.service';

// 只在临时目录构建旧 schema 并应用本次 migration，不接触开发数据库。
const directory = mkdtempSync(join(tmpdir(), 'flowx-control-db-'));
const databaseUrl = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const workflow = new WorkflowService(prisma as never, new WorkflowStateMachine(), {} as never,
  { sendStageCompleted: vi.fn() } as never, {} as never, {} as never,
  { getPlanArtifactPaths: () => ({ planMetaPath: null, planHtmlPath: null }) } as never, {} as never);
const control = new ExecutionControlService(prisma as never, workflow);
let scope: { organizationId: string; userId: string; organizationRole: string };
let workspaceId: string;
let projectId: string;
let requirementId: string;

beforeAll(async () => {
  const schema = readFileSync(resolve('../../prisma/schema.prisma'), 'utf8')
    .replace(/^\s+(controlMode|blockedReason|cancelRequestedAt|activeControlDeviceKey|commands)\s+.*$/gm, '')
    .replace(/model ExecutionCommand \{[\s\S]*?\n\}/, '');
  const schemaPath = join(directory, 'schema.prisma');
  writeFileSync(schemaPath, schema);
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'], { env, encoding: 'utf8' });
  const migration = readFileSync(resolve('../../prisma/migrations/20260930090000_add_execution_control/migration.sql'), 'utf8');
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', databaseUrl, '--stdin'], { env, input: sql + '\n' + migration });
  const organization = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: randomUUID(), name: '测试组织' } });
  const user = await prisma.user.create({ data: { displayName: '执行人' } });
  scope = { organizationId: organization.id, userId: user.id, organizationRole: 'member' };
  workspaceId = (await prisma.workspace.create({ data: { name: '测试空间', organizationId: organization.id } })).id;
  projectId = (await prisma.project.create({ data: { name: '测试项目', workspaceId } })).id;
  requirementId = (await prisma.requirement.create({ data: { title: '控制链路', description: '', acceptanceCriteria: '', projectId, workspaceId } })).id;
}, 30_000);

afterAll(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

async function session() {
  const run = await prisma.workflowRun.create({ data: { requirementId, status: 'EXECUTION_RUNNING', currentStage: 'EXECUTION' } });
  const stage = await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'EXECUTION', status: 'RUNNING', input: { executor: 'LOCAL' } } });
  return prisma.executionSession.create({ data: {
    workflowRunId: run.id, stageExecutionId: stage.id, workspaceId, projectId,
    organizationId: scope.organizationId, claimedByUserId: scope.userId,
    executorType: 'LOCAL', sourceTool: 'codex', status: 'RUNNING', protocolVersion: '1.2', traceId: randomUUID(),
  } });
}

describe('执行控制真实 SQLite 链路', () => {
  it('实质进展先筛选再分页，不被大量心跳挤掉，并继续校验组织访问', async () => {
    const row = await session();
    const service = new SyncEventsService(prisma as never, new ExecutionSessionsService(prisma as never));
    const recordedAt = Date.now();
    const types = ['execution.started', 'execution.progressed', 'execution.blocked', ...Array.from({ length: 101 }, () => 'execution.heartbeat'), 'evidence.reported'];
    await prisma.syncEvent.createMany({ data: types.map((eventType, index) => ({
      executionSessionId: row.id, eventId: randomUUID(), idempotencyKey: randomUUID(),
      schemaVersion: '1.2', traceId: row.traceId, sourceTool: 'codex', eventType,
      payload: { summary: `记录 ${index}` }, occurredAt: new Date(recordedAt + index),
    })) });
    const first = await service.list(row.id, { view: 'progress', take: 2 }, scope);
    expect(first.items.map((item) => item.eventType)).toEqual(['execution.blocked', 'execution.progressed']);
    const second = await service.list(row.id, { view: 'progress', take: 2, cursor: first.nextCursor! }, scope);
    expect(second.items.map((item) => item.eventType)).toEqual(['execution.started']);
    expect(second.nextCursor).toBeNull();
    await expect(service.list(row.id, { view: 'progress' }, { organizationId: 'other-org' })).rejects.toThrow();
    const legacy = await service.list(row.id, { take: 2 }, scope);
    expect(legacy.items.map((item) => item.eventType)).toEqual(['evidence.reported', 'execution.heartbeat']);
  });

  it('开发进展在全量筛选后分页，异常跨页置顶，返回真实进度和总数', async () => {
    const project = await prisma.project.create({ data: { name: '并行项目', workspaceId } });
    const requirement = await prisma.requirement.create({ data: {
      title: '并行登录改造', description: '', acceptanceCriteria: '', projectId: project.id, workspaceId,
    } });
    const rows = [];
    for (const [index, status] of ['RUNNING', 'BLOCKED', 'RUNNING', 'FAILED', 'COMPLETED', 'CANCELLED'].entries()) {
      const row = await session();
      await prisma.workflowRun.update({ where: { id: row.workflowRunId! }, data: { requirementId: requirement.id } });
      rows.push(await prisma.executionSession.update({ where: { id: row.id }, data: {
        projectId: project.id, status, controlMode: 'COOPERATIVE',
        lastHeartbeatAt: new Date(Date.now() - (index === 2 ? 600_000 : 1000)),
        createdAt: new Date(Date.now() - index * 1000),
        blockedReason: status === 'BLOCKED' ? '等待接口确认' : null,
        summary: status === 'COMPLETED' ? '登录改造已完成' : null,
      } }));
    }
    await prisma.syncEvent.create({ data: {
      executionSessionId: rows[0].id, eventId: randomUUID(), idempotencyKey: randomUUID(),
      schemaVersion: '1.2', traceId: rows[0].traceId, sourceTool: 'codex',
      eventType: 'execution.progressed', payload: { summary: '正在执行回归测试' }, occurredAt: new Date(),
    } });
    await prisma.evidence.create({ data: {
      executionSessionId: rows[0].id, evidenceType: 'TEST_RESULT', sourceTool: 'codex',
      title: '回归测试', summary: '18/20 通过',
    } });
    await prisma.evidence.createMany({ data: Array.from({ length: 6 }, (_, index) => ({
      executionSessionId: rows[0].id, evidenceType: 'BUILD_RESULT', sourceTool: 'codex',
      title: `构建 ${index}`, occurredAt: new Date(Date.now() + 1000 + index),
    })) });
    const filters = { page: 1, take: 2, view: 'active', projectId: project.id,
      claimedByUserId: scope.userId, sourceTool: 'codex', search: ' 登录 ' } as const;
    const first = await control.list(filters, scope);
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(first).toMatchObject({ counts: { active: 3, attention: 3, completed: 1, all: 6 } });
    expect(first.items.map((row) => row.id)).toEqual([rows[1].id, rows[2].id]);
    const second = await control.list({ ...filters, page: 2 }, scope);
    expect(second.items.map((row) => row.id)).toEqual([rows[0].id]);
    expect(second.items[0]).toMatchObject({ project: { name: '并行项目' },
      syncEvents: [{ payload: { summary: '正在执行回归测试' } }] });
    expect('evidence' in second.items[0] && second.items[0].evidence).toEqual(expect.arrayContaining([expect.objectContaining({ summary: '18/20 通过' })]));
    await prisma.syncEvent.createMany({ data: Array.from({ length: 101 }, (_, index) => ({
      executionSessionId: rows[0].id, eventId: randomUUID(), idempotencyKey: randomUUID(),
      schemaVersion: '1.2', traceId: rows[0].traceId, sourceTool: 'codex',
      eventType: 'execution.heartbeat', payload: {}, occurredAt: new Date(Date.now() + index + 1),
    })) });
    const detail = await new ExecutionSessionsService(prisma as never, workflow).findOne(rows[0].id, scope, true);
    expect(detail).toMatchObject({ project: { name: '并行项目' }, latestProgress: { payload: { summary: '正在执行回归测试' } } });
    expect(await control.list({ ...filters, page: 99 }, scope)).toMatchObject({ page: 2 });
    expect(await control.list({ ...filters, view: 'attention', take: 20 }, scope)).toMatchObject({ total: 3 });
    expect(await control.list({ ...filters, view: 'completed' }, scope)).toMatchObject({ total: 1, items: [{ id: rows[4].id }] });
    expect(await control.list({ ...filters, view: 'all' }, scope)).toMatchObject({ total: 6 });
    expect(await control.list({ ...filters, claimedByUserId: 'other' }, scope)).toMatchObject({ total: 0, page: 1, items: [] });
    expect(await control.list({ ...filters, claimedByUserId: 'other' }, scope)).toMatchObject({ counts: { active: 0, attention: 0, completed: 0, all: 0 } });
    expect(await control.list({ ...filters, search: '不存在' }, scope)).toMatchObject({ total: 0 });
    expect(await control.list(filters, { ...scope, organizationId: 'another' })).toMatchObject({ total: 0 });
    await prisma.executionSession.update({ where: { id: rows[0].id }, data: { executorType: 'CLOUD' } });
    expect(await control.list({ ...filters, view: 'all' }, scope)).toMatchObject({ total: 5 });
    await prisma.stageExecution.update({ where: { id: rows[1].stageExecutionId! }, data: { stage: 'SPEC_PLAN' } });
    expect(await control.list({ ...filters, view: 'all' }, scope)).toMatchObject({ total: 4 });
  });

  it('未知回报和终态不误判失联，可空字段不会导致分页漏项，旧游标继续可用', async () => {
    const project = await prisma.project.create({ data: { name: '未知回报项目', workspaceId } });
    const updates = [
      { status: 'RUNNING', controlMode: 'COOPERATIVE', lastHeartbeatAt: null },
      { status: 'RUNNING', controlMode: 'NONE', lastHeartbeatAt: new Date(0) },
      { status: 'RUNNING', controlMode: 'COOPERATIVE', lastHeartbeatAt: new Date(), cancelRequestedAt: new Date() },
      { status: 'COMPLETED', controlMode: 'COOPERATIVE', lastHeartbeatAt: new Date(0), cancelRequestedAt: new Date() },
      { status: 'CANCELLED', controlMode: 'COOPERATIVE', lastHeartbeatAt: new Date(0) },
    ];
    const ids = [];
    for (const [index, update] of updates.entries()) {
      const row = await session();
      await prisma.executionSession.update({ where: { id: row.id }, data: {
        ...update, projectId: project.id, createdAt: new Date(Date.now() - index * 1000),
      } });
      ids.push(row.id);
    }
    const all = await control.list({ projectId: project.id, page: 1, view: 'all' }, scope);
    expect(all.items.map((item) => item.id)).toEqual([ids[2], ids[0], ids[1], ids[3], ids[4]]);
    expect(all.items.filter((item) => item.health === 'UNKNOWN')).toHaveLength(2);
    expect(await control.list({ projectId: project.id, page: 1, view: 'attention' }, scope)).toMatchObject({ total: 1 });
    expect(await control.list({ projectId: project.id, page: 1, status: 'CANCELLED' }, scope)).toMatchObject({ total: 1 });
    expect(await control.list({ projectId: project.id, page: 1, status: 'CANCELLED' }, scope)).toMatchObject({
      counts: { active: 3, attention: 1, completed: 1, all: 5 },
    });
    const legacy = await control.list({ projectId: project.id, take: 2 }, scope);
    expect(legacy.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(legacy.nextCursor).toBe(ids[1]);
    const next = await control.list({ projectId: project.id, cursor: legacy.nextCursor!, take: 2 }, scope);
    expect(next.items.map((item) => item.id)).toEqual(ids.slice(2, 4));
  });

  it('检查点回传具体进展，重试不重复写事件，终态与待停止会话不覆盖已有结果', async () => {
    const row = await session();
    const deviceId = randomUUID();
    const input = { deviceId, progressSummary: '已完成接口调整，正在执行回归测试' };
    await control.checkpoint(row.id, input, scope);
    await control.checkpoint(row.id, input, scope);
    expect(await prisma.syncEvent.count({ where: { executionSessionId: row.id, eventType: 'execution.progressed' } })).toBe(1);
    expect(await prisma.executionSession.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ summary: input.progressSummary });
    const detail = await new ExecutionSessionsService(prisma as never, workflow).findOne(row.id, scope, true);
    expect(detail).toMatchObject({ latestProgress: { payload: { summary: input.progressSummary } } });
    await prisma.executionSession.update({ where: { id: row.id }, data: { cancelRequestedAt: new Date() } });
    await control.checkpoint(row.id, { deviceId, progressSummary: '不应覆盖的进展' }, scope);
    expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: row.id } })).summary).toBe(input.progressSummary);
    await prisma.executionSession.update({ where: { id: row.id }, data: { status: 'COMPLETED', summary: '完成摘要' } });
    await control.checkpoint(row.id, input, scope);
    expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: row.id } })).summary).toBe('完成摘要');
    await expect(control.checkpoint(row.id, { deviceId, progressSummary: ' ' }, scope)).rejects.toThrow(/进度摘要不能为空/);
  });

  it('取消只有本地回执后才推进工作流；重复请求和回执不会重复推进', async () => {
    const row = await session();
    const deviceId = randomUUID();
    await control.checkpoint(row.id, { deviceId }, scope);
    const command = await control.request(row.id, { commandType: 'CANCEL', idempotencyKey: 'cancel-1' }, scope);
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: row.workflowRunId! } })).status).toBe('EXECUTION_RUNNING');
    expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: row.id } })).cancelRequestedAt).not.toBeNull();
    expect((await control.checkpoint(row.id, { deviceId }, scope)).commands).toHaveLength(1);
    await control.acknowledge(row.id, command.id, { deviceId, outcome: 'ACKED' }, scope);
    await control.acknowledge(row.id, command.id, { deviceId, outcome: 'ACKED' }, scope);
    expect((await control.request(row.id, { commandType: 'CANCEL', idempotencyKey: 'cancel-1' }, scope)).id).toBe(command.id);
    expect(await prisma.executionSession.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'CANCELLED', activeControlDeviceKey: null });
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: row.workflowRunId! } })).status).toBe('EXECUTION_PENDING');
    expect(await prisma.executionCommand.count({ where: { executionSessionId: row.id } })).toBe(1);
  });

  it('每设备一个受控活动会话，跨组织、换设备与其他执行人都不能控制', async () => {
    const first = await session();
    const second = await session();
    const deviceId = randomUUID();
    await control.checkpoint(first.id, { deviceId }, scope);
    await expect(control.checkpoint(second.id, { deviceId }, scope)).rejects.toThrow(/已有活动会话/);
    await expect(control.checkpoint(first.id, { deviceId: 'another' }, scope)).rejects.toThrow(/其他设备/);
    await expect(control.checkpoint(first.id, { deviceId }, { ...scope, userId: 'another' })).rejects.toThrow(/原执行人/);
    await expect(control.request(first.id, { commandType: 'CANCEL', idempotencyKey: 'k' }, { ...scope, organizationId: 'another' })).rejects.toThrow(/不存在/);
    expect((await control.list({}, { ...scope, organizationId: 'another' })).items).toEqual([]);
  });

  it('阻塞后只有恢复回执能回到运行，过期命令不能回执', async () => {
    const row = await session();
    const deviceId = randomUUID();
    await control.checkpoint(row.id, { deviceId, blockedReason: '等待接口确认' }, scope);
    const command = await control.request(row.id, { commandType: 'RESUME', idempotencyKey: 'resume-1' }, scope);
    expect((await control.checkpoint(row.id, { deviceId }, scope)).session.status).toBe('BLOCKED');
    await control.acknowledge(row.id, command.id, { deviceId, outcome: 'ACKED' }, scope);
    expect(await prisma.executionSession.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'RUNNING', blockedReason: null });
    const sync = await control.request(row.id, { commandType: 'REQUEST_SYNC', idempotencyKey: 'sync-1' }, scope);
    await control.checkpoint(row.id, { deviceId }, scope);
    await prisma.executionCommand.update({ where: { id: sync.id }, data: { expiresAt: new Date(0) } });
    await expect(control.acknowledge(row.id, sync.id, { deviceId, outcome: 'ACKED' }, scope)).rejects.toThrow(/过期/);
  });

  it('工作流被推进后，取消回执整体回滚，保留待回执命令', async () => {
    const row = await session();
    const deviceId = randomUUID();
    await control.checkpoint(row.id, { deviceId }, scope);
    const command = await control.request(row.id, { commandType: 'CANCEL', idempotencyKey: 'cancel' }, scope);
    await control.checkpoint(row.id, { deviceId }, scope);
    await prisma.workflowRun.update({ where: { id: row.workflowRunId! }, data: { status: 'REVIEW_PENDING' } });
    await expect(control.acknowledge(row.id, command.id, { deviceId, outcome: 'ACKED' }, scope)).rejects.toThrow();
    expect((await prisma.executionCommand.findUniqueOrThrow({ where: { id: command.id } })).status).toBe('DELIVERED');
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: row.workflowRunId! } })).status).toBe('REVIEW_PENDING');
  });
});
