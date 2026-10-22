import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecutionSessionsController } from './execution-sessions.controller';
import { ExecutionSessionsService } from './execution-sessions.service';
import { SyncEventsService } from './sync-events.service';
import { ExecutionControlService } from './execution-control.service';
import { ArtifactsController } from '../artifacts/artifacts.controller';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { EvidenceService } from '../artifacts/evidence.service';
import { LocalArtifactStorageProvider } from '../artifacts/local-artifact-storage.provider';

const directory = mkdtempSync(join(tmpdir(), 'flowx-local-owner-http-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const sessions = new ExecutionSessionsService(prisma as never);
const events = new SyncEventsService(prisma as never, sessions);
const artifacts = new ArtifactsService(prisma as never, sessions, new LocalArtifactStorageProvider());
const evidence = new EvidenceService(prisma as never, sessions);
const previousStoreRoot = process.env.FLOWX_ARTIFACT_STORE_ROOT;
process.env.FLOWX_ARTIFACT_STORE_ROOT = join(directory, 'artifacts');
Reflect.defineMetadata('design:paramtypes', [ExecutionSessionsService, SyncEventsService, ExecutionControlService], ExecutionSessionsController);
Reflect.defineMetadata('design:paramtypes', [ArtifactsService, EvidenceService], ArtifactsController);
@Module({ controllers: [ExecutionSessionsController, ArtifactsController], providers: [
  { provide: ExecutionSessionsService, useValue: sessions },
  { provide: SyncEventsService, useValue: events },
  { provide: ExecutionControlService, useValue: { describe: () => ({}) } },
  { provide: ArtifactsService, useValue: artifacts },
  { provide: EvidenceService, useValue: evidence },
] })
class LocalOwnershipHttpModule {}

let app: INestApplication;
let baseUrl: string;
let org: string;
let workspace: string;
let owner: string;
let other: string;
beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  org = (await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: randomUUID(), name: '执行归属测试' } })).id;
  workspace = (await prisma.workspace.create({ data: { name: '测试空间', organizationId: org } })).id;
  owner = (await prisma.user.create({ data: { displayName: '甲' } })).id;
  other = (await prisma.user.create({ data: { displayName: '乙' } })).id;
  app = await NestFactory.create(LocalOwnershipHttpModule, { logger: false, rawBody: true });
  app.useBodyParser('raw', { type: 'application/octet-stream' });
  app.use((req: { headers: Record<string, string>; authSession?: unknown }, _res: unknown, next: () => void) => {
    req.authSession = { user: { id: req.headers['x-user-id'], displayName: '测试用户' }, organization: { id: org, role: req.headers['x-organization-role'] ?? 'member' } }; next();
  });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
}, 30_000);
afterAll(async () => {
  await app?.close(); await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true });
  if (previousStoreRoot === undefined) delete process.env.FLOWX_ARTIFACT_STORE_ROOT;
  else process.env.FLOWX_ARTIFACT_STORE_ROOT = previousStoreRoot;
});

async function createSession(status = 'RUNNING', claimedByUserId: string | null = owner) {
  return prisma.executionSession.create({ data: { executorType: 'LOCAL', sourceTool: 'codex', controlMode: 'NONE',
    protocolVersion: '1.0', traceId: randomUUID(), organizationId: org, workspaceId: workspace, claimedByUserId, status } });
}
function eventPayload(id: string) {
  return { eventId: randomUUID(), schemaVersion: '1.0', sourceTool: 'codex', traceId: randomUUID(), entityType: 'execution-session', entityId: id,
    eventType: 'execution.progressed', payload: { summary: '已分析' }, occurredAt: new Date().toISOString(), idempotencyKey: randomUUID() };
}
function post(id: string, action: string, userId: string, body: unknown = {}) {
  return fetch(`${baseUrl}/execution-sessions/${id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': userId }, body: JSON.stringify(body) });
}

describe('LOCAL NONE 会话通用写入口真实 HTTP 与 SQLite 归属边界', () => {
  it.each(['start', 'heartbeat', 'complete', 'fail', 'cancel', 'events'])('其他成员不能通过 %s 写入他人的会话', async (action) => {
    const session = await createSession(action === 'start' ? 'CLAIMED' : 'RUNNING');
    const response = await post(session.id, action, other, action === 'events' ? eventPayload(session.id) : {});
    expect(response.status).toBe(403);
    const persisted = await prisma.executionSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(persisted.status).toBe(session.status);
    expect(persisted.lastHeartbeatAt).toBeNull();
    expect(await prisma.syncEvent.count({ where: { executionSessionId: session.id } })).toBe(0);
  });

  it.each(['start', 'heartbeat', 'complete', 'fail', 'cancel', 'events'])('原执行人仍可使用 %s', async (action) => {
    const session = await createSession(action === 'start' ? 'CLAIMED' : 'RUNNING');
    const response = await post(session.id, action, owner, action === 'events' ? eventPayload(session.id) : {});
    expect(response.status).toBe(201);
  });

  it('没有领取人记录的旧会话提示重新交接，不允许组织成员写入', async () => {
    const session = await createSession('RUNNING', null);
    const response = await post(session.id, 'heartbeat', owner);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'LOCAL_TASK_OWNER_UNRECORDED' });
  });

  it('已完成会话的幂等重试仍先核对原执行人', async () => {
    const session = await createSession('COMPLETED');
    expect((await post(session.id, 'complete', other)).status).toBe(403);
    expect((await post(session.id, 'complete', owner)).status).toBe(201);
  });

  it('取消的旧会话连原执行人也不能追加产物、证据、内容或重新启动', async () => {
    const session = await createSession('CANCELLED');
    const artifact = await prisma.artifact.create({ data: {
      executionSessionId: session.id, workspaceId: workspace, artifactType: 'LOG', name: 'test.log', storageProvider: 'local',
      storageKey: `managed/${session.id}/late.log`, status: 'PENDING', version: '1', byteSize: 4,
      sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    } });
    expect((await post(session.id, 'artifacts', owner, {
      artifactType: 'LOG', name: '晚到结果', storageProvider: 'external', externalUrl: 'https://example.com/late',
    })).status).toBe(409);
    expect((await post(session.id, 'artifact-uploads', owner, {
      artifactType: 'LOG', name: 'late.log', byteSize: 4, sha256: 'a'.repeat(64),
    })).status).toBe(409);
    expect((await post(session.id, 'evidence', owner, { evidenceType: 'TEST_RESULT', sourceTool: 'codex', title: '晚到证据' })).status).toBe(409);
    expect((await post(session.id, 'events', owner, eventPayload(session.id))).status).toBe(409);
    expect((await post(session.id, 'start', owner)).status).toBe(409);
    expect((await fetch(`${baseUrl}/artifacts/${artifact.id}/content`, { method: 'PUT', headers: {
      'x-user-id': owner, 'content-type': 'application/octet-stream',
    }, body: 'test' })).status).toBe(409);
    expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('CANCELLED');
    expect(await prisma.artifact.count({ where: { executionSessionId: session.id } })).toBe(1);
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).status).toBe('PENDING');
    expect(await prisma.evidence.count({ where: { executionSessionId: session.id } })).toBe(0);
  });

  it('同组织成员仍可以读取会话和事件', async () => {
    const session = await createSession();
    const detail = await fetch(`${baseUrl}/execution-sessions/${session.id}`, { headers: { 'x-user-id': other } });
    expect(detail.status).toBe(200);
    const history = await fetch(`${baseUrl}/execution-sessions/${session.id}/events`, { headers: { 'x-user-id': other } });
    expect(history.status).toBe(200);
  });

  it.each(['artifacts', 'artifact-uploads', 'evidence'])('产物与证据 %s 只能由原执行人创建', async (action) => {
    const session = await createSession();
    const payload = action === 'evidence' ? { evidenceType: 'TEST_RESULT', sourceTool: 'codex', title: '测试证据' } :
      action === 'artifacts' ? { artifactType: 'LOG', name: '日志', storageProvider: 'external', externalUrl: 'https://example.com/log' } :
      { artifactType: 'LOG', name: 'test.log', byteSize: 4, sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' };
    expect((await post(session.id, action, other, payload)).status).toBe(403);
    expect(await prisma.artifact.count({ where: { executionSessionId: session.id } })).toBe(0);
    expect(await prisma.evidence.count({ where: { executionSessionId: session.id } })).toBe(0);
    expect((await post(session.id, action, owner, payload)).status).toBe(201);
  });

  it.each(['PUT', 'DELETE'])('产物 %s 按关联会话校验执行人，其他成员仍可读取', async (method) => {
    const session = await createSession();
    const artifact = await prisma.artifact.create({ data: {
      executionSessionId: session.id, workspaceId: workspace, artifactType: 'LOG', name: 'test.log', storageProvider: 'local',
      storageKey: `managed/${session.id}/test.log`, status: 'PENDING', version: '1', byteSize: 4,
      sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    } });
    const endpoint = `${baseUrl}/artifacts/${artifact.id}${method === 'PUT' ? '/content' : ''}`;
    const request = (userId: string) => fetch(endpoint, { method, headers: { 'x-user-id': userId, 'content-type': 'application/octet-stream' }, ...(method === 'PUT' ? { body: 'test' } : {}) });
    expect((await fetch(`${baseUrl}/artifacts/${artifact.id}`, { headers: { 'x-user-id': other } })).status).toBe(200);
    expect((await request(other)).status).toBe(403);
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).status).toBe('PENDING');
    expect((await request(owner)).status).toBe(200);
  });

  it.each(['PUT', 'DELETE'])('无会话历史设计稿公共 %s 返回恢复提示且保留只读', async (method) => {
    const artifact = await legacyDesignArtifact(null);
    const readable = await fetch(`${baseUrl}/artifacts/${artifact.id}`, { headers: { 'x-user-id': other } });
    expect(readable.status).toBe(200);
    for (const userId of [owner, other]) {
      const response = await modifyArtifact(artifact.id, method, userId, 'admin');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'LOCAL_TASK_OWNER_UNRECORDED', message: expect.stringContaining('重新生成') });
    }
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).status).toBe('PENDING');
  });

  it.each(['PUT', 'DELETE'])('有作者的无会话兼容设计稿公共 %s 不允许其他成员或管理员冒写', async (method) => {
    const artifact = await legacyDesignArtifact(owner);
    expect((await modifyArtifact(artifact.id, method, other, 'admin')).status).toBe(403);
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).status).toBe('PENDING');
    expect((await modifyArtifact(artifact.id, method, owner)).status).toBe(200);
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).status).toBe(method === 'DELETE' ? 'DELETED' : 'AVAILABLE');
  });

  it.each(['BRAINSTORM', 'DESIGN', 'SPEC_PLAN'])('专用 %s 阶段不能用通用终态接口绕过编排', async (stage) => {
    const project = await prisma.project.create({ data: { workspaceId: workspace, name: '阶段测试' } });
    const requirement = await prisma.requirement.create({ data: { workspaceId: workspace, projectId: project.id, title: '测试', description: '', acceptanceCriteria: '' } });
    const workflow = await prisma.workflowRun.create({ data: { requirementId: requirement.id, currentStage: stage, status: `${stage}_PENDING` } });
    const execution = await prisma.stageExecution.create({ data: { workflowRunId: workflow.id, stage, status: 'RUNNING' } });
    for (const action of ['complete', 'cancel', 'fail']) {
      const session = await createSession();
      await prisma.executionSession.update({ where: { id: session.id }, data: { workflowRunId: workflow.id, stageExecutionId: execution.id } });
      expect((await post(session.id, action, owner)).status).toBe(409);
      expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('RUNNING');
    }
  });

  it('本地冒烟任务必须走专用回传，通用终态接口不能绕过租约聚合', async () => {
    const project = await prisma.project.create({ data: { workspaceId: workspace, name: '冒烟测试' } });
    const version = await prisma.projectVersion.create({ data: { projectId: project.id, name: 'v1' } });
    const request = await prisma.testRequest.create({ data: {
      workspaceId: workspace, projectId: project.id, projectVersionId: version.id, title: '冒烟', traceId: randomUUID(),
    } });
    const plan = await prisma.testPlan.create({ data: { testRequestId: request.id } });
    const run = await prisma.testRun.create({ data: { testPlanId: plan.id, name: '本地冒烟' } });
    for (const action of ['complete', 'cancel', 'fail']) {
      const session = await createSession();
      await prisma.executionSession.update({ where: { id: session.id }, data: { testRunId: run.id } });
      expect((await post(session.id, action, owner)).status).toBe(409);
      expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('RUNNING');
    }
  });
});

async function legacyDesignArtifact(createdByUserId: string | null) {
  const project = await prisma.project.create({ data: { workspaceId: workspace, name: '兼容设计稿测试' } });
  const requirement = await prisma.requirement.create({ data: { workspaceId: workspace, projectId: project.id, title: '旧设计稿', description: '', acceptanceCriteria: '' } });
  const workflow = await prisma.workflowRun.create({ data: { requirementId: requirement.id, currentStage: 'DESIGN', status: 'DESIGN_WAITING_CONFIRMATION' } });
  return prisma.artifact.create({ data: {
    workflowRunId: workflow.id, workspaceId: workspace, artifactType: 'DESIGN_HTML', name: 'design.html', storageProvider: 'local',
    storageKey: `managed/legacy/${randomUUID()}/design.html`, status: 'PENDING', version: '1', byteSize: 4, createdByUserId,
    sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  } });
}

function modifyArtifact(id: string, method: string, userId: string, role = 'member') {
  return fetch(`${baseUrl}/artifacts/${id}${method === 'PUT' ? '/content' : ''}`, { method,
    headers: { 'x-user-id': userId, 'x-organization-role': role, 'content-type': 'application/octet-stream' },
    ...(method === 'PUT' ? { body: 'test' } : {}),
  });
}
