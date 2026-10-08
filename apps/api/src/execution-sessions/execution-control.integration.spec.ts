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
