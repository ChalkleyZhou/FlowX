import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RequirementsController } from './requirements.controller';
import { RequirementsService } from './requirements.service';
import { RequirementAssignmentsService } from './requirement-assignments.service';
import { CreatePrototypeRequirementChangeDto } from './dto/create-requirement-change.dto';
import { RequirementChangePrototypeService } from './requirement-change-prototype.service';
import { PrototypeArchive } from '../prototype-imports/prototype-archive';
import { RequirementChangesService } from './requirement-changes.service';
import { effectiveRequirementDescription } from './requirement-change-context';
import { analysis } from '../prototype-imports/prototype-test-fixture';
import { applyOrganizationScope } from '../prisma/organization-scope';

const directory = mkdtempSync(join(tmpdir(), 'flowx-changes-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const workflow = { restartFromRequirementChange: vi.fn() };
const service = new RequirementChangesService(prisma as never, workflow as never);
const author = { user: { id: 'author', displayName: '提交人' }, organization: { id: 'org' } };
let projectId: string;
beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql });
  await prisma.organization.create({ data: { id: 'org', provider: 'test', providerOrganizationId: 'changes', name: '变更组织' } });
  const workspace = await prisma.workspace.create({ data: { name: '变更空间', organizationId: 'org' } });
  projectId = (await prisma.project.create({ data: { name: '变更项目', workspaceId: workspace.id } })).id;
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
async function requirement() { return prisma.requirement.create({ data: { title: '导出', description: '原始描述', acceptanceCriteria: '', projectId } }); }

describe('正式需求变更', () => {
  it('列表和重启按组织隔离，其他组织不能触发流程或读取原型元数据', async () => {
    const req = await requirement();
    const change = await service.create(req.id, { content: '隔离检查', mode: 'RESTART', requestId: 'scope-check' }, author);
    const other = { ...author, organization: { id: 'other' } };
    await expect(service.list(req.id, undefined, other)).rejects.toMatchObject({ status: 404 });
    await expect(service.restart(req.id, change.id, other)).rejects.toMatchObject({ status: 404 });
  });

  it('拒绝空内容与未认证作者，不产生修订', async () => {
    const req = await requirement();
    await expect(service.create(req.id, { content: '  ', mode: 'SUPPLEMENT', requestId: 'blank' }, author)).rejects.toMatchObject({ status: 400 });
    await expect(service.create(req.id, { content: '增加 Excel', mode: 'SUPPLEMENT', requestId: 'auth' }, undefined)).rejects.toMatchObject({ status: 403 });
    expect((await service.list(req.id)).revision).toBe(0);
  });
  it('一句话增量、作者、时间和单调修订持久化，幂等重复不增加修订', async () => {
    const req = await requirement();
    const dto = { content: '  导出增加 Excel 格式  ', mode: 'SUPPLEMENT' as const, requestId: 'one' };
    const first = await service.create(req.id, dto, author);
    expect(first).toMatchObject({ revision: 1, content: '导出增加 Excel 格式', createdByName: '提交人', restartStatus: 'NOT_REQUESTED' });
    expect((await service.create(req.id, dto, author)).id).toBe(first.id);
    await service.create(req.id, { ...dto, content: '支持筛选', requestId: 'two' }, author);
    const rows = await new RequirementChangesService(prisma as never, workflow as never).list(req.id);
    expect(rows.changes.map((row) => row.revision)).toEqual([1, 2]);
    expect(rows.revision).toBe(2);
    expect((await prisma.requirement.findUniqueOrThrow({ where: { id: req.id } })).description).toBe('原始描述');
  });
  it('并发提交维持连续修订，同 requestId 并发只保存一条', async () => {
    const req = await requirement();
    const dto = { content: '并发同一条', mode: 'SUPPLEMENT' as const, requestId: 'parallel-same' };
    const same = await Promise.all([service.create(req.id, dto, author), service.create(req.id, dto, author)]);
    expect(same[0].id).toBe(same[1].id);
    await Promise.all(['A', 'B'].map((content) => service.create(req.id, { ...dto, content, requestId: `parallel-${content}` }, author)));
    expect((await service.list(req.id)).changes.map((row) => row.revision)).toEqual([1, 2, 3]);
  });
  it('同 requestId 不允许静默更换正文或提交方式', async () => {
    const req = await requirement();
    await service.create(req.id, { content: 'A', mode: 'SUPPLEMENT', requestId: 'same' }, author);
    await expect(service.create(req.id, { content: 'B', mode: 'RESTART', requestId: 'same' }, author)).rejects.toMatchObject({ status: 409 });
  });
  it('跨需求来源与跨组织读取被隔离', async () => {
    const req = await requirement(); const other = await requirement();
    const source = await prisma.workflowRun.create({ data: { requirementId: other.id } });
    await expect(service.create(req.id, { content: '非法来源', mode: 'SUPPLEMENT', requestId: 'source', sourceWorkflowRunId: source.id }, author)).rejects.toMatchObject({ status: 404 });
    const scoped = prisma.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) { return query(applyOrganizationScope(model, operation, args, 'other-org')); } } } });
    await expect(new RequirementChangesService(scoped as never, workflow as never).list(req.id)).rejects.toMatchObject({ status: 404 });
    expect(applyOrganizationScope('RequirementChange', 'findMany', {}, 'org')).toMatchObject({ where: { requirement: { project: { workspace: { organizationId: 'org' } } } } });
  });
  it('重新走流程先持久化，冲突保留待启动且重试与并发只建一个流程', async () => {
    const req = await requirement();
    workflow.restartFromRequirementChange.mockRejectedValueOnce(new Error('仓库仍有活跃任务，请结束后重试'));
    const record = await service.create(req.id, { content: '重新设计导出', mode: 'RESTART', requestId: 'restart' }, author);
    expect(record).toMatchObject({ restartStatus: 'PENDING', errorMessage: expect.stringContaining('活跃任务') });
    workflow.restartFromRequirementChange.mockImplementation(async (changeId: string) => {
      const run = await prisma.workflowRun.create({ data: { requirementId: req.id, sourceChangeId: changeId } });
      return run;
    });
    const results = await Promise.all([service.restart(req.id, record.id), service.restart(req.id, record.id)]);
    const latest = (await service.list(req.id)).changes[0];
    expect(latest.restartStatus).toBe('STARTED');
    expect(latest.restartWorkflowRunId).toBeTruthy();
    expect(await prisma.workflowRun.count({ where: { sourceChangeId: record.id } })).toBe(1);
    await service.restart(req.id, record.id);
    expect(await prisma.workflowRun.count({ where: { sourceChangeId: record.id } })).toBe(1);
    expect(results).toHaveLength(2);
  });
  it('过期旧启动回调不能覆盖新租约已成功启动的结果', async () => {
    const req = await requirement();
    workflow.restartFromRequirementChange.mockImplementationOnce(async (changeId: string) => {
      await prisma.workflowRun.create({ data: { requirementId: req.id, sourceChangeId: changeId } });
      await prisma.requirementChange.update({ where: { id: changeId }, data: { restartStatus: 'STARTED', errorMessage: null, updatedAt: new Date(Date.now() + 1000) } });
      throw new Error('旧租约的准备回调已过期');
    });
    const result = await service.create(req.id, { content: '租约恢复', mode: 'RESTART', requestId: 'lease-owner' }, author);
    expect(result).toMatchObject({ restartStatus: 'STARTED', errorMessage: null });
    expect(result.restartWorkflowRunId).toBeTruthy();
  });
  it('grounding 在启动完成写回前快速失败，不会被 STARTED 完成回调覆盖', async () => {
    const req = await requirement();
    workflow.restartFromRequirementChange.mockImplementationOnce(async (changeId: string) => {
      const run = await prisma.workflowRun.create({ data: { requirementId: req.id, sourceChangeId: changeId, status: 'FAILED', currentStage: 'REPOSITORY_GROUNDING' } });
      await prisma.requirementChange.update({ where: { id: changeId }, data: { restartStatus: 'FAILED', errorMessage: '仓库上下文准备失败' } });
      return run;
    });
    const result = await service.create(req.id, { content: '快速失败', mode: 'RESTART', requestId: 'fast-grounding' }, author);
    expect(result).toMatchObject({ restartStatus: 'FAILED', errorMessage: '仓库上下文准备失败' });
    expect(result.restartWorkflowRunId).toBeTruthy();
  });
  it('中断的 STARTING 租约到期后恢复可重试状态，待执行阶段不能冒充已读取', async () => {
    const req = await requirement();
    const row = await prisma.requirementChange.create({ data: { requirementId: req.id, revision: 1, content: '恢复', mode: 'RESTART', requestId: 'lease', createdByUserId: 'author', createdByName: '提交人', restartStatus: 'STARTING', updatedAt: new Date(Date.now() - 11 * 60_000) } });
    await prisma.requirement.update({ where: { id: req.id }, data: { revision: 1 } });
    expect((await service.list(req.id)).changes[0]).toMatchObject({ id: row.id, restartStatus: 'FAILED', errorMessage: expect.stringContaining('继续启动流程') });
    const run = await prisma.workflowRun.create({ data: { requirementId: req.id, currentStage: 'SPEC_PLAN', status: 'SPEC_PLAN_PENDING' } });
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'DESIGN', status: 'COMPLETED', input: { requirementRevision: 1 } } });
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', status: 'PENDING' } });
    expect(await service.list(req.id, run.id)).toMatchObject({ contextRevision: 0, hasPendingChanges: true });
  });
  it('列表两次读取之间并发新增变更时，响应修订不能落后于已返回记录', async () => {
    const req = await requirement();
    const run = await prisma.workflowRun.create({ data: { requirementId: req.id, status: 'EXECUTION_RUNNING', currentStage: 'EXECUTION' } });
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'EXECUTION', status: 'RUNNING', input: { requirementRevision: 0 } } });
    let readDone!: () => void; let resume!: () => void;
    const read = new Promise<void>((resolve) => { readDone = resolve; });
    const resumed = new Promise<void>((resolve) => { resume = resolve; });
    const staleRead = vi.spyOn(service as unknown as { ensureRequirement: (id: string) => Promise<typeof req> }, 'ensureRequirement').mockImplementationOnce(async () => { readDone(); await resumed; return req; });
    const listing = service.list(req.id, run.id);
    await read;
    try {
      await service.create(req.id, { content: '读取期间并发补充', mode: 'SUPPLEMENT', requestId: 'during-list' }, author);
      resume();
      const result = await listing;
      expect(result.changes).toHaveLength(1);
      expect(result).toMatchObject({ revision: 1, contextRevision: 0, hasPendingChanges: true });
    } finally { resume(); staleRead.mockRestore(); }
  });
  it('旧任务保留读取修订，后续上下文包含全部正式增量', async () => {
    const req = await requirement();
    const run = await prisma.workflowRun.create({ data: { requirementId: req.id } });
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'EXECUTION', status: 'RUNNING', input: { requirementRevision: 0 } } });
    await service.create(req.id, { content: '增加 Excel', mode: 'SUPPLEMENT', requestId: 'context' }, author);
    const result = await service.list(req.id, run.id);
    expect(result).toMatchObject({ contextRevision: 0, hasPendingChanges: true });
    const latest = await prisma.requirement.findUniqueOrThrow({ where: { id: req.id }, include: { changes: true } });
    expect(effectiveRequirementDescription(latest)).toContain('增加 Excel');
    expect(effectiveRequirementDescription(latest)).toContain('最新变更');
    expect(effectiveRequirementDescription(latest)).toContain('原始描述');
  });
});


describe('正式变更上传原型', () => {
  const prototype = { archiveId: 'archive-1', name: 'new.zip', sha256: 'hash', aiProvider: 'cursor', manifest: { files: [{ path: 'index.html' }], sources: [{ name: 'new.zip', revision: 1 }] } };
  const snapshot = { source: 'prototype-import', importId: 'archive-1', revision: 1, materialRevision: 1, confirmedAt: new Date().toISOString(), confirmedBy: null, analysis };
  function setup() {
    const prototypes = { store: vi.fn(async () => structuredClone(prototype)), analyze: vi.fn(async () => snapshot), remove: vi.fn(), download: vi.fn(async () => Buffer.from('zip')) };
    const instance = new RequirementChangesService(prisma as never, workflow as never, prototypes as never);
    return { instance, prototypes };
  }
  it('上传后后台分析，保留原描述和旧产物，幂等重试只保存一次且拒绝同键换包', async () => {
    const req = await requirement(); const { instance, prototypes } = setup();
    const dto = { content: '新原型', mode: 'RESTART' as const, requestId: 'zip-one', aiProvider: 'cursor' as const };
    workflow.restartFromRequirementChange.mockResolvedValue({});
    const first = await instance.createWithPrototype(req.id, dto, Buffer.from('zip'), 'new.zip', author);
    expect(first).toMatchObject({ restartStatus: 'STARTING', prototype: { name: 'new.zip', aiProvider: 'cursor' } });
    await vi.waitFor(async () => expect((await instance.list(req.id)).changes[0].restartStatus).toBe('STARTED'));
    const row = await prisma.requirementChange.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.prototype).toMatchObject({ snapshot });
    expect((await prisma.requirement.findUniqueOrThrow({ where: { id: req.id } })).description).toBe('原始描述');
    expect(effectiveRequirementDescription({ description: '原始描述', changes: [row] })).toContain(analysis.description);
    expect((await instance.createWithPrototype(req.id, dto, Buffer.from('zip'), 'new.zip', author)).id).toBe(first.id);
    expect(prototypes.store).toHaveBeenCalledTimes(1);
    await expect(instance.createWithPrototype(req.id, dto, Buffer.from('different'), 'new.zip', author)).rejects.toMatchObject({ status: 409 });
    expect(await instance.downloadPrototype(req.id, first.id, author)).toEqual(Buffer.from('zip'));
  });
  it('拒绝匿名、跨组织、补充模式和已被文本占用的提交键，不保存 ZIP', async () => {
    const req = await requirement(); const { instance, prototypes } = setup();
    const dto = { content: '新原型', mode: 'RESTART' as const, requestId: 'security' };
    await expect(instance.createWithPrototype(req.id, dto, Buffer.from('zip'), 'new.zip')).rejects.toMatchObject({ status: 403 });
    await expect(instance.createWithPrototype(req.id, dto, Buffer.from('zip'), 'new.zip', { ...author, organization: { id: 'other' } })).rejects.toMatchObject({ status: 404 });
    await expect(instance.createWithPrototype(req.id, { ...dto, mode: 'SUPPLEMENT' }, Buffer.from('zip'), 'new.zip', author)).rejects.toMatchObject({ status: 400 });
    await service.create(req.id, { ...dto, mode: 'SUPPLEMENT' }, author);
    await expect(instance.createWithPrototype(req.id, dto, Buffer.from('zip'), 'new.zip', author)).rejects.toMatchObject({ status: 409 });
    expect(prototypes.store).not.toHaveBeenCalled();
  });
  it('AI 失败保留文件且脱敏，重试成功后启动失败也不重复分析', async () => {
    const req = await requirement(); const { instance, prototypes } = setup();
    prototypes.analyze.mockRejectedValueOnce(new Error('CODEX_AUTH_EXPIRED secret-token'));
    const first = await instance.createWithPrototype(req.id, { content: '', mode: 'RESTART', requestId: 'zip-fail' }, Buffer.from('zip'), 'new.zip', author);
    await vi.waitFor(async () => expect((await instance.list(req.id)).changes[0].restartStatus).toBe('FAILED'));
    expect((await instance.list(req.id)).changes[0].errorMessage).not.toContain('secret-token');
    workflow.restartFromRequirementChange.mockRejectedValueOnce(new Error('repository unavailable'));
    await instance.restart(req.id, first.id);
    await vi.waitFor(async () => expect((await instance.list(req.id)).changes[0].restartStatus).toBe('FAILED'));
    expect(prototypes.analyze).toHaveBeenCalledTimes(2);
    workflow.restartFromRequirementChange.mockResolvedValueOnce({});
    await instance.restart(req.id, first.id);
    await vi.waitFor(async () => expect((await instance.list(req.id)).changes[0].restartStatus).toBe('STARTED'));
    expect(prototypes.analyze).toHaveBeenCalledTimes(2);
    expect(prototypes.store).toHaveBeenCalledTimes(1);
  });
});


const validZip = Buffer.from('UEsDBBQAAAAIABySV11zzTvYFwAAABUAAAAKAAAAaW5kZXguaHRtbLPJMLR7Nm3D886Op33zn87rttEHCgAAUEsBAhQDFAAAAAgAHJJXXXPNO9gXAAAAFQAAAAoAAAAAAAAAAAAAAIABAAAAAGluZGV4Lmh0bWxQSwUGAAAAAAEAAQA4AAAAPwAAAAAA', 'base64');
const analyzePrototype = vi.fn(async () => structuredClone(analysis));
const resolveInvocationContext = vi.fn(async () => ({}));
const prototypeHandler = new RequirementChangePrototypeService({ get: () => ({ analyzePrototype }) } as never,
  { normalizeAiProvider: (value?: string) => value ?? 'codex', resolveOnlineProvider: async (_organizationId?: string, value?: string) => value ?? 'codex', resolveInvocationContext } as never);
Object.assign(prototypeHandler, { archive: new PrototypeArchive(join(directory, 'materials')) });
const httpService = new RequirementChangesService(prisma as never, workflow as never, prototypeHandler);
@Module({ controllers: [RequirementsController], providers: [
  { provide: RequirementsService, useValue: {} }, { provide: RequirementAssignmentsService, useValue: {} },
  { provide: RequirementChangesService, useValue: httpService },
] })
class PrototypeChangeTestModule {}
Reflect.defineMetadata('design:paramtypes', [RequirementsService, RequirementAssignmentsService, RequirementChangesService], RequirementsController);
Reflect.defineMetadata('design:paramtypes', [String, CreatePrototypeRequirementChangeDto, Object, Object], RequirementsController.prototype, 'createPrototypeChange');
let app: INestApplication, baseUrl: string;
beforeAll(async () => {
  app = await NestFactory.create(PrototypeChangeTestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.use((req: { headers: Record<string, string>; authSession?: unknown }, _res: unknown, next: () => void) => {
    if (req.headers['x-org']) req.authSession = { ...author, organization: { id: req.headers['x-org'] } };
    next();
  });
  await app.listen(0, '127.0.0.1'); baseUrl = await app.getUrl();
});
afterAll(async () => { await app?.close(); });

describe('原型变更 HTTP 与真实归档', () => {
  function form(overrides: Record<string, string> = {}, file = validZip) {
    const body = new FormData();
    Object.entries({ mode: 'RESTART', requestId: 'http-zip', ...overrides }).forEach(([key, value]) => body.append(key, value));
    body.append('file', new Blob([file]), '原型.zip'); return body;
  }
  it('multipart 省略说明可提交，真实保存原包、组织 AI 分析与下载，无需确认', async () => {
    const req = await requirement();
    const source = await prisma.workflowRun.create({ data: { requirementId: req.id, status: 'DONE', aiProvider: 'cursor' } });
    workflow.restartFromRequirementChange.mockResolvedValue({});
    expect(await httpService.list(req.id, source.id)).toMatchObject({ aiProvider: 'cursor' });
    const response = await fetch(`${baseUrl}/requirements/${req.id}/changes/prototype`, { method: 'POST', headers: { 'x-org': 'org' }, body: form() });
    expect(response.status).toBe(201);
    const change = await response.json() as { id: string; content: string };
    expect(change.content).toBe('更新原型：原型.zip');
    await vi.waitFor(async () => expect((await httpService.list(req.id)).changes[0].restartStatus).toBe('STARTED'));
    expect(resolveInvocationContext).toHaveBeenLastCalledWith('cursor', expect.objectContaining({ flowxOrganizationId: 'org', flowxUserId: 'author' }));
    expect(analyzePrototype).toHaveBeenLastCalledWith(expect.objectContaining({ material: expect.stringContaining('新版原型'), answers: {} }), {});
    expect(analyzePrototype.mock.calls.at(-1)?.[0]).not.toHaveProperty('previous');
    const download = await fetch(`${baseUrl}/requirements/${req.id}/changes/${change.id}/source`, { headers: { 'x-org': 'org' } });
    expect(download.status).toBe(200); expect(Buffer.from(await download.arrayBuffer())).toEqual(validZip);
    expect((await fetch(`${baseUrl}/requirements/${req.id}/changes/${change.id}/source`, { headers: { 'x-org': 'other' } })).status).toBe(404);
    expect((await fetch(`${baseUrl}/requirements/${req.id}/changes/${change.id}/source`)).status).toBe(403);
  });
  it('非法 AI、补充模式、缺失幂等键与损坏 ZIP 均不产生变更或影响旧轮', async () => {
    const req = await requirement();
    const endpoint = `${baseUrl}/requirements/${req.id}/changes/prototype`;
    for (const values of [{ aiProvider: 'unknown' }, { mode: 'SUPPLEMENT' }, { requestId: '' }]) {
      expect((await fetch(endpoint, { method: 'POST', headers: { 'x-org': 'org' }, body: form(values) })).status).toBe(400);
    }
    expect((await fetch(endpoint, { method: 'POST', headers: { 'x-org': 'org' }, body: form({}, Buffer.from('broken')) })).status).toBe(400);
    expect((await fetch(endpoint, { method: 'POST', headers: { 'x-org': 'other' }, body: form() })).status).toBe(404);
    expect((await httpService.list(req.id)).revision).toBe(0);
  });
});
