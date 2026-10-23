import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AnalyzePrototypeImportDto, CreatePrototypeImportDto, SupplementPrototypeImportDto, UpdatePrototypeImportDto } from './dto/prototype-import.dto';
import { PrototypeImportsController } from './prototype-imports.controller';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { PrototypeArchive } from './prototype-archive';
import { confirmedPrototypeAnalysis, PrototypeImportsService } from './prototype-imports.service';
import { analysis } from './prototype-test-fixture';

const directory = mkdtempSync(join(tmpdir(), 'flowx-prototype-service-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const manifest = { files: [{ path: 'index.html', bytes: 100, kind: 'html' }], pages: [{ path: 'index.html', title: '看板' }], kinds: ['html'], warnings: [], sources: [{ name: 'prototype.zip', revision: 1 }] };
const archive = { save: vi.fn(async () => manifest), context: vi.fn(async () => '原型内容'), remove: vi.fn(), download: vi.fn(), preview: vi.fn(), surfaces: vi.fn(async () => []) };
const executor = { analyzePrototype: vi.fn(async () => structuredClone(analysis)) };
let org: string, project: string, workspace: string;
let service: PrototypeImportsService;
let app: INestApplication, baseUrl: string;
@Module({ controllers: [PrototypeImportsController], providers: [{ provide: PrototypeImportsService, useFactory: () => service }] })
class TestModule {}
Reflect.defineMetadata('design:paramtypes', [PrototypeImportsService], PrototypeImportsController);
Reflect.defineMetadata('design:paramtypes', [CreatePrototypeImportDto, Object, Object], PrototypeImportsController.prototype, 'create');
Reflect.defineMetadata('design:paramtypes', [String, UpdatePrototypeImportDto, Object], PrototypeImportsController.prototype, 'confirm');
Reflect.defineMetadata('design:paramtypes', [String, AnalyzePrototypeImportDto, Object], PrototypeImportsController.prototype, 'analyze');
Reflect.defineMetadata('design:paramtypes', [String, SupplementPrototypeImportDto, Object, Object], PrototypeImportsController.prototype, 'supplement');
const actor = () => ({ user: { id: 'user-a', displayName: '用户' }, organization: { id: org } });
beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  org = (await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: 'prototype-test', name: '测试' } })).id;
  workspace = (await prisma.workspace.create({ data: { name: '工作区', organizationId: org } })).id;
  project = (await prisma.project.create({ data: { name: '项目', workspaceId: workspace } })).id;
  const requirements = { create: async (dto: { title: string; description: string; acceptanceCriteria: string; projectId: string }) => prisma.requirement.create({ data: { ...dto, workspaceId: workspace } }) };
  service = new PrototypeImportsService(prisma as never, { get: () => executor } as never, { normalizeAiProvider: () => 'codex', resolveInvocationContext: async () => ({}) } as never, { createWorkflowRun: async () => { throw new Error('仓库未配置'); } } as never);
  Object.assign(service, { archive });
  app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.use((req: { headers: Record<string, string>; authSession?: unknown }, _res: unknown, next: () => void) => { if (req.headers['x-org-id']) req.authSession = { ...actor(), organization: { id: req.headers['x-org-id'] } }; next(); });
  await app.listen(0, '127.0.0.1'); baseUrl = await app.getUrl();
}, 30_000);
afterAll(async () => { await app?.close(); await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
async function create() {
  const result = await service.create({ projectId: project, goal: '管理事项' }, Buffer.from('zip'), 'prototype.zip', actor());
  await vi.waitFor(async () => expect((await service.get(result.id, actor())).status).not.toBe('ANALYZING'));
  await prisma.ideationArtifact.deleteMany({ where: { requirementId: result.requirementId } });
  // 旧确认接口的兼容性测试使用显式旧记录。
  await prisma.prototypeImport.update({ where: { id: result.id }, data: { status: 'WAITING_CONFIRMATION', analysis: JSON.parse(JSON.stringify(analysis)), errorMessage: null, confirmedAt: null, confirmedBy: null } });
  return service.get(result.id, actor());
}
describe('原型导入到确认', () => {
  it('未回答的可选问题不能自动采用 AI 建议，应保留待确认项', () => {
    const draft = { ...analysis, clarifications: [...analysis.clarifications, { id: 'retention', question: '数据保留多久？', required: false, suggestedAnswer: '永久保留' }] };
    const confirmed = confirmedPrototypeAnalysis(draft, { permission: '创建人' });
    expect(confirmed.description).not.toContain('永久保留');
    expect(confirmed.design.designRationale).not.toContain('永久保留');
    expect(confirmed.brief.openQuestions).toContain('数据保留多久？');
    expect(confirmed.description).toContain('谁可以删除事项？：创建人');
  });

  it('异步整理无需填写标题和验收标准，保留来源与原型', async () => {
    const result = await create();
    expect(result.analysis).toEqual(analysis);
    expect(result.manifest).toEqual(manifest);
    expect(result.requirementId).toBeTruthy();
    expect(executor.analyzePrototype).toHaveBeenCalled();
  });

  it('快捷导入使用显式标题与项目版本，不受当前版本变化影响', async () => {
    const selected = await prisma.projectVersion.create({ data: { projectId: project, name: '快捷创建显示版本' } });
    const current = await prisma.projectVersion.create({ data: { projectId: project, name: '之后切换的当前版本' } });
    await prisma.project.update({ where: { id: project }, data: { currentVersionId: current.id } });
    const body = new FormData(); body.append('projectId', project); body.append('title', '  原型快捷标题  '); body.append('versionId', selected.id); body.append('file', new Blob(['zip']), '原型.zip');
    const response = await fetch(`${baseUrl}/prototype-imports`, { method: 'POST', headers: { 'x-org-id': org }, body });
    expect(response.status).toBe(201);
    const result = await response.json() as { id: string; requirementId: string };
    expect(await prisma.requirement.findUniqueOrThrow({ where: { id: result.requirementId } })).toMatchObject({ title: '原型快捷标题', versionId: selected.id });
    expect((await service.get(result.id, actor())).goal).toBe('原型快捷标题');
    await vi.waitFor(async () => expect((await service.get(result.id, actor())).status).not.toBe('ANALYZING'));
    await prisma.project.update({ where: { id: project }, data: { currentVersionId: null } });
  });

  it('非法或跨项目版本在保存 ZIP 前拒绝，未指定版本仍兼容当前版本', async () => {
    const other = await prisma.project.create({ data: { name: '其他项目', workspaceId: workspace } });
    const foreign = await prisma.projectVersion.create({ data: { name: '其他项目版本', projectId: other.id } });
    for (const versionId of ['missing', foreign.id]) {
      const count = await prisma.requirement.count(); const saves = archive.save.mock.calls.length;
      await expect(service.create({ projectId: project, title: '无效版本', versionId } as CreatePrototypeImportDto, Buffer.from('zip'), 'test.zip', actor())).rejects.toMatchObject({ status: 400 });
      expect(await prisma.requirement.count()).toBe(count); expect(archive.save).toHaveBeenCalledTimes(saves);
    }
    const current = await prisma.projectVersion.create({ data: { name: '默认版本', projectId: project } });
    await prisma.project.update({ where: { id: project }, data: { currentVersionId: current.id } });
    const result = await create();
    expect(await prisma.requirement.findUniqueOrThrow({ where: { id: result.requirementId } })).toMatchObject({ versionId: current.id });
    await prisma.project.update({ where: { id: project }, data: { currentVersionId: null } });
  });
  it('校验组织，匿名和其他组织无法读取或补传', async () => {
    const result = await create();
    await expect(service.get(result.id, undefined)).rejects.toMatchObject({ status: 403 });
    await expect(service.get(result.id, { ...actor(), organization: { id: 'another' } })).rejects.toMatchObject({ status: 404 });
    await expect(service.create({ projectId: project }, Buffer.from('zip'), 'test.zip', { ...actor(), organization: { id: 'another' } })).rejects.toMatchObject({ status: 404 });
  });
  it('关键问题未回答不能确认，保存用户修改后确认即锁定', async () => {
    const result = await create();
    await expect(service.confirm(result.id, { revision: result.revision, analysis, answers: {} }, actor())).rejects.toMatchObject({ status: 400 });
    const confirmed = await service.confirm(result.id, { revision: result.revision, analysis: { ...analysis, title: '我的事项' }, answers: { permission: '仅创建人可删除' } }, actor());
    expect(confirmed.status).toBe('CONFIRMED');
    const requirement = await prisma.requirement.findUniqueOrThrow({ where: { id: result.requirementId }, include: { ideationArtifacts: true } });
    expect(requirement.title).toBe('我的事项');
    expect(requirement.description).toContain('仅创建人可删除');
    expect(requirement.ideationArtifacts.map((a) => a.type).sort()).toEqual(['BRAINSTORM_BRIEF', 'DESIGN_SPEC']);
    await expect(service.analyze(result.id, { revision: confirmed.revision }, actor())).rejects.toMatchObject({ status: 409 });
  });
  it('不能手改移除必答项，合并答案后超限也不写入半确认结果', async () => {
    const result = await create();
    await expect(service.confirm(result.id, { revision: result.revision, analysis: { ...analysis, clarifications: [] }, answers: {} }, actor())).rejects.toMatchObject({ status: 400 });
    await expect(service.confirm(result.id, { revision: result.revision, analysis: { ...analysis, description: 'x'.repeat(19999) }, answers: { permission: 'x'.repeat(10000) } }, actor())).rejects.toMatchObject({ status: 400 });
    expect((await service.get(result.id, actor())).status).toBe('WAITING_CONFIRMATION');
  });
  it('旧版本或并发确认只有一人成功，且不重复创建产物', async () => {
    const result = await create();
    const input = { revision: result.revision, analysis, answers: { permission: '创建人' } };
    const results = await Promise.allSettled([service.confirm(result.id, input, actor()), service.confirm(result.id, input, actor())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.ideationArtifact.count({ where: { requirementId: result.requirementId } })).toBe(2);
  });
  it('失败保留旧整理结果，可重试和补传，旧分析不能覆盖新版本', async () => {
    const result = await create();
    executor.analyzePrototype.mockRejectedValueOnce(new Error('secret upstream token'));
    const running = await service.analyze(result.id, { revision: result.revision, feedback: '更新权限' }, actor());
    await vi.waitFor(async () => expect((await service.get(result.id, actor())).status).toBe('FAILED'));
    const failed = await service.get(result.id, actor());
    expect(failed.analysis).toEqual(analysis);
    expect(failed.errorMessage).not.toContain('secret');
    const supplemented = await service.supplement(result.id, { revision: running.revision }, Buffer.from('newzip'), 'more.zip', actor());
    await vi.waitFor(async () => expect((await service.get(result.id, actor())).status).not.toBe('ANALYZING'));
    expect(supplemented.materialRevision).toBeGreaterThan(result.materialRevision);
    expect(archive.save).toHaveBeenLastCalledWith(result.id, supplemented.materialRevision, expect.any(Buffer), 'more.zip', result.materialRevision);
  });
  it('服务重启后的分析变为可重试失败', async () => {
    const result = await create();
    await prisma.prototypeImport.update({ where: { id: result.id }, data: { status: 'ANALYZING' } });
    await service.onModuleInit();
    expect((await service.get(result.id, actor())).status).toBe('FAILED');
  });
});

describe('原型确认后的真实工作流接续', () => {
  function workflowService() {
    return new WorkflowService(prisma as never, new WorkflowStateMachine(), {
      syncWorkspaceRepositories: async () => undefined,
      prepareWorkflowRepositories: async () => undefined,
      generateWorkflowRepositoryGrounding: async () => undefined,
      buildWorkflowRepositoryPath: () => '/tmp/flowx-prototype-test',
    } as never, {} as never, { normalizeAiProvider: () => 'codex' } as never, {} as never, {} as never, {} as never);
  }
  it('未确认时API也不可启动；确认后无仓库不重复确认', async () => {
    const result = await create();
    const workflow = workflowService();
    await expect(workflow.createWorkflowRun({ requirementId: result.requirementId })).rejects.toThrow(/导入/);
    await service.confirm(result.id, { revision: result.revision, answers: { permission: '创建人' } }, actor());
    await expect(workflow.createWorkflowRun({ requirementId: result.requirementId })).rejects.toThrow(/仓库/);
    expect((await service.get(result.id, actor())).status).toBe('CONFIRMED');
  });
  it('仓库grounding后直接到Spec&Plan，构思跳过、设计复用且来源可追溯', async () => {
    const result = await create();
    await service.confirm(result.id, { revision: result.revision, answers: { permission: '创建人' } }, actor());
    await prisma.repository.create({ data: { workspaceId: workspace, name: 'web', url: 'https://example.com/web.git', defaultBranch: 'main' } });
    const surfaces = vi.spyOn(PrototypeArchive.prototype, 'surfaces').mockResolvedValue([]);
    const workflow = await workflowService().createWorkflowRun({ requirementId: result.requirementId });
    await vi.waitFor(async () => expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: workflow.id } })).status).toBe('SPEC_PLAN_PENDING'));
    const stages = await prisma.stageExecution.findMany({ where: { workflowRunId: workflow.id } });
    expect(stages.find((stage) => stage.stage === 'REQUIREMENT_INTAKE')?.output).toMatchObject({ source: 'prototype-import', importId: result.id, revision: result.revision + 1 });
    expect(stages.find((stage) => stage.stage === 'BRAINSTORM')?.status).toBe('SKIPPED');
    expect(stages.find((stage) => stage.stage === 'DESIGN')).toMatchObject({ status: 'COMPLETED', output: { design: { overview: analysis.design.overview, designRationale: expect.stringContaining('创建人') }, source: 'prototype-import' } });
    expect(stages.find((stage) => stage.stage === 'SPEC_PLAN')?.status).toBe('PENDING');
    surfaces.mockRestore();
  });
});

describe('原型导入 HTTP 边界', () => {
  it('补传接受所选 AI，非法执行器在保存材料之前拒绝', async () => {
    const imported = await create();
    const saves = archive.save.mock.calls.length;
    function form(aiProvider: string) {
      const body = new FormData(); body.append('file', new Blob(['zip']), 'more.zip'); body.append('revision', String(imported.revision)); body.append('aiProvider', aiProvider); return body;
    }
    const endpoint = `${baseUrl}/prototype-imports/${imported.id}/files`;
    expect((await fetch(endpoint, { method: 'POST', headers: { 'x-org-id': org }, body: form('unknown') })).status).toBe(400);
    expect(archive.save).toHaveBeenCalledTimes(saves);
    expect((await service.get(imported.id, actor())).revision).toBe(imported.revision);
    const response = await fetch(endpoint, { method: 'POST', headers: { 'x-org-id': org }, body: form('cursor') });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ aiProvider: 'cursor', materialRevision: imported.revision + 1 });
    await vi.waitFor(async () => expect((await service.get(imported.id, actor())).status).not.toBe('ANALYZING'));
  });
  it('切换重试 AI 校验执行器、组织权限和修订，未指定时沿用已保存的 AI', async () => {
    const imported = await create();
    await prisma.prototypeImport.update({ where: { id: imported.id }, data: { status: 'FAILED', analysis: Prisma.JsonNull } });
    const post = (body: unknown, organizationId?: string) => fetch(`${baseUrl}/prototype-imports/${imported.id}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(organizationId ? { 'x-org-id': organizationId } : {}) }, body: JSON.stringify(body) });
    for (const aiProvider of ['unknown', '', null, 123]) {
      expect((await post({ revision: imported.revision, aiProvider }, org)).status).toBe(400);
    }
    expect((await post({ revision: imported.revision, aiProvider: 'cursor' })).status).toBe(403);
    expect((await post({ revision: imported.revision, aiProvider: 'cursor' }, 'other')).status).toBe(404);
    expect((await post({ revision: imported.revision - 1, aiProvider: 'cursor' }, org)).status).toBe(409);
    expect(await service.get(imported.id, actor())).toMatchObject({ aiProvider: 'codex', status: 'FAILED', revision: imported.revision });
    const response = await post({ revision: imported.revision, aiProvider: 'cursor' }, org);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ aiProvider: 'cursor', status: 'ANALYZING' });
    await vi.waitFor(async () => expect((await service.get(imported.id, actor())).status).toBe('FAILED'));
    const failed = await service.get(imported.id, actor());
    const retry = await post({ revision: failed.revision }, org);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toMatchObject({ aiProvider: 'cursor' });
    await vi.waitFor(async () => expect((await service.get(imported.id, actor())).status).not.toBe('ANALYZING'));
  });
  it('multipart无需标题即可创建，未登录或跨组织禁止创建', async () => {
    function form() { const body = new FormData(); body.append('projectId', project); body.append('file', new Blob(['zip']), '原型.zip'); return body; }
    expect((await fetch(`${baseUrl}/prototype-imports`, { method: 'POST', body: form() })).status).toBe(403);
    expect((await fetch(`${baseUrl}/prototype-imports`, { method: 'POST', headers: { 'x-org-id': 'other' }, body: form() })).status).toBe(404);
    const response = await fetch(`${baseUrl}/prototype-imports`, { method: 'POST', headers: { 'x-org-id': org }, body: form() });
    expect(response.status).toBe(201);
    const result = await response.json() as { id: string };
    await vi.waitFor(async () => expect((await service.get(result.id, actor())).status).not.toBe('ANALYZING'));
    expect((await fetch(`${baseUrl}/prototype-imports/${result.id}/preview?path=index.html`, { headers: { 'x-org-id': 'other' } })).status).toBe(404);
  });
  it('拒绝缺少文件、无效revision和非法答案格式', async () => {
    const body = new FormData(); body.append('projectId', project);
    expect((await fetch(`${baseUrl}/prototype-imports`, { method: 'POST', headers: { 'x-org-id': org }, body })).status).toBe(400);
    const result = await create();
    for (const input of [{ revision: 0 }, { revision: result.revision, answers: 'bad' }]) {
      expect((await fetch(`${baseUrl}/prototype-imports/${result.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-org-id': org }, body: JSON.stringify(input) })).status).toBe(400);
    }
  });
});


describe('快速导入自动接续', () => {
  it('已识别的凭证错误明确提示可切换 AI，且不泄露上游内容', async () => {
    for (const code of ['CODEX_AUTH_INVALID_ORG_KEY', 'CURSOR_AUTH_MISSING', 'CODEX_ORGANIZATION_CREDENTIAL_REQUIRED', 'CURSOR_CREDENTIAL_DECRYPT_FAILED']) {
      const imported = await create();
      executor.analyzePrototype.mockRejectedValueOnce(new Error(`${code}: secret-upstream-token`));
      await service.analyze(imported.id, { revision: imported.revision, feedback: '重新整理' }, actor());
      await vi.waitFor(async () => expect((await service.get(imported.id, actor())).status).toBe('FAILED'));
      const failed = await service.get(imported.id, actor());
      expect(failed.errorMessage).toContain('认证失败或凭证不可用');
      expect(failed.errorMessage).toContain('切换其他 AI');
      expect(failed.errorMessage).not.toContain('secret-upstream-token');
    }
  });
  it.each(['analyze', 'supplement'] as const)('%s 失败后可切换执行器，凭据和后续工作流使用新 AI，保留原需求与材料', async (method) => {
    const codex = { analyzePrototype: vi.fn().mockRejectedValue(new Error('CODEX_AUTH_REQUIRED')) };
    const cursor = { analyzePrototype: vi.fn().mockResolvedValue(structuredClone(analysis)) };
    const registry = { get: vi.fn((provider: string) => provider === 'cursor' ? cursor : codex) };
    const invocation = { normalizeAiProvider: (provider?: string) => provider ?? 'codex', resolveInvocationContext: vi.fn(async (provider: string) => ({ requestUserId: 'user-a', source: provider })) };
    const start = vi.fn(async (dto: { requirementId: string }) => prisma.workflowRun.create({ data: { requirementId: dto.requirementId, status: 'REPOSITORY_GROUNDING_PENDING', stageExecutions: { create: { stage: 'REPOSITORY_GROUNDING', status: 'RUNNING', attempt: 1 } } } }));
    const automatic = new PrototypeImportsService(prisma as never, registry as never, invocation as never, { createWorkflowRun: start } as never);
    Object.assign(automatic, { archive });
    const imported = await automatic.create({ projectId: project, aiProvider: 'codex' }, Buffer.from('zip'), 'retry.zip', actor());
    await vi.waitFor(async () => expect((await automatic.get(imported.id, actor())).status).toBe('FAILED'));
    const failed = await automatic.get(imported.id, actor());
    const saves = archive.save.mock.calls.length;
    const retry = { revision: failed.revision, aiProvider: 'cursor' as const };
    const running = method === 'analyze'
      ? await automatic.analyze(imported.id, retry, actor())
      : await automatic.supplement(imported.id, retry, Buffer.from('newzip'), 'more.zip', actor());
    expect(running).toMatchObject({ aiProvider: 'cursor', status: 'ANALYZING', requirementId: imported.requirementId, materialRevision: method === 'analyze' ? imported.materialRevision : imported.materialRevision + 1 });
    await expect(automatic.analyze(imported.id, retry, actor())).rejects.toMatchObject({ status: 409 });
    await vi.waitFor(async () => expect(await automatic.get(imported.id, actor())).toMatchObject({ status: 'CONFIRMED', workflowRunId: expect.any(String) }));
    expect(cursor.analyzePrototype).toHaveBeenCalledTimes(1);
    expect(codex.analyzePrototype).toHaveBeenCalledTimes(1);
    expect(invocation.resolveInvocationContext).toHaveBeenLastCalledWith('cursor', expect.objectContaining({ flowxOrganizationId: org, flowxUserId: 'user-a' }));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ requirementId: imported.requirementId, aiProvider: 'cursor' }));
    expect(archive.save).toHaveBeenCalledTimes(saves + (method === 'analyze' ? 0 : 1));
  });

  it('补传新材料分析失败后，重试必须重新分析新包，不能套用旧结果', async () => {
    const start = vi.fn().mockRejectedValue(new Error('仓库暂不可用'));
    const automatic = new PrototypeImportsService(prisma as never, { get: () => executor } as never, { normalizeAiProvider: () => 'codex', resolveInvocationContext: async () => ({}) } as never, { createWorkflowRun: start } as never);
    Object.assign(automatic, { archive });
    const imported = await automatic.create({ projectId: project }, Buffer.from('zip'), 'old.zip', actor());
    await vi.waitFor(async () => expect((await automatic.get(imported.id, actor())).status).toBe('FAILED'));
    const failed = await automatic.get(imported.id, actor());
    executor.analyzePrototype.mockRejectedValueOnce(new Error('新材料整理失败'));
    await automatic.supplement(imported.id, { revision: failed.revision }, Buffer.from('new'), 'new.zip', actor());
    await vi.waitFor(async () => expect((await automatic.get(imported.id, actor())).status).toBe('FAILED'));
    const newFailure = await automatic.get(imported.id, actor());
    const calls = executor.analyzePrototype.mock.calls.length;
    executor.analyzePrototype.mockResolvedValueOnce({ ...structuredClone(analysis), title: '新材料结果' });
    await automatic.analyze(imported.id, { revision: newFailure.revision }, actor());
    await vi.waitFor(async () => expect((await automatic.get(imported.id, actor())).analysis?.title).toBe('新材料结果'));
    expect(executor.analyzePrototype).toHaveBeenCalledTimes(calls + 1);
    await vi.waitFor(async () => expect((await automatic.get(imported.id, actor())).status).toBe('FAILED'));
  });

  it('仓库准备时重启，清理未完成的 CREATED 后可重新接入，不永久等待', async () => {
    const imported = await create();
    await prisma.prototypeImport.update({ where: { id: imported.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    const incomplete = await prisma.workflowRun.create({ data: { requirementId: imported.requirementId, status: 'CREATED' } });
    const start = vi.fn(async (dto: { requirementId: string }) => prisma.workflowRun.create({ data: { requirementId: dto.requirementId, status: 'REPOSITORY_GROUNDING_PENDING', stageExecutions: { create: { stage: 'REPOSITORY_GROUNDING', status: 'RUNNING', attempt: 1 } } } }));
    const automatic = new PrototypeImportsService(prisma as never, { get: () => executor } as never, { normalizeAiProvider: () => 'codex', resolveInvocationContext: async () => ({}) } as never, { createWorkflowRun: start } as never);
    Object.assign(automatic, { archive });
    await automatic.onModuleInit();
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: incomplete.id } })).status).toBe('FAILED');
    const failed = await automatic.get(imported.id, actor());
    expect(failed.status).toBe('FAILED');
    await automatic.analyze(imported.id, { revision: failed.revision }, actor());
    await vi.waitFor(async () => expect(await automatic.get(imported.id, actor())).toMatchObject({ status: 'CONFIRMED', workflowRunId: expect.any(String) }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('接续失败明确报错，重试复用整理结果且只保留一份产物', async () => {
    const start = vi.fn();
    start.mockRejectedValueOnce(new Error('secret repository credential')).mockImplementationOnce(async (dto: { requirementId: string }) => prisma.workflowRun.create({ data: { requirementId: dto.requirementId, status: 'REPOSITORY_GROUNDING_PENDING', stageExecutions: { create: { stage: 'REPOSITORY_GROUNDING', status: 'RUNNING', attempt: 1 } } } }));
    const automatic = new PrototypeImportsService(prisma as never, { get: () => executor } as never, { normalizeAiProvider: () => 'codex', resolveInvocationContext: async () => ({}) } as never, { createWorkflowRun: start } as never);
    Object.assign(automatic, { archive });
    const imported = await automatic.create({ projectId: project }, Buffer.from('zip'), 'retry.zip', actor());
    await vi.waitFor(async () => expect((await automatic.get(imported.id, actor())).status).toBe('FAILED'));
    const failed = await automatic.get(imported.id, actor());
    expect(failed.workflowRunId).toBeNull();
    expect(failed.errorMessage).toContain('接入研发流程失败');
    expect(failed.errorMessage).not.toContain('secret');
    const calls = executor.analyzePrototype.mock.calls.length;
    await automatic.analyze(imported.id, { revision: failed.revision }, actor());
    await vi.waitFor(async () => expect(await automatic.get(imported.id, actor())).toMatchObject({ status: 'CONFIRMED', workflowRunId: expect.any(String) }));
    expect(executor.analyzePrototype).toHaveBeenCalledTimes(calls);
    expect(await prisma.ideationArtifact.count({ where: { requirementId: imported.requirementId } })).toBe(2);
    expect(await prisma.workflowRun.count({ where: { requirementId: imported.requirementId } })).toBe(1);
  });

  it('旧等待确认记录接续复用已保存的整理，不再请求用户或重跑 AI', async () => {
    const imported = await create();
    const start = vi.fn(async (dto: { requirementId: string }) => prisma.workflowRun.create({ data: { requirementId: dto.requirementId, status: 'REPOSITORY_GROUNDING_PENDING', stageExecutions: { create: { stage: 'REPOSITORY_GROUNDING', status: 'RUNNING', attempt: 1 } } } }));
    const automatic = new PrototypeImportsService(prisma as never, { get: () => executor } as never, { normalizeAiProvider: () => 'codex', resolveInvocationContext: async () => ({}) } as never, { createWorkflowRun: start } as never);
    Object.assign(automatic, { archive });
    const calls = executor.analyzePrototype.mock.calls.length;
    await automatic.analyze(imported.id, { revision: imported.revision }, actor());
    await vi.waitFor(async () => expect(await automatic.get(imported.id, actor())).toMatchObject({ status: 'CONFIRMED', workflowRunId: expect.any(String) }));
    expect(executor.analyzePrototype).toHaveBeenCalledTimes(calls);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('无需回答关键问题，成功自动落库并接入真实工作流，未回答内容保留为待澄清', async () => {
    const workflow = new WorkflowService(prisma as never, new WorkflowStateMachine(), {
      syncWorkspaceRepositories: async () => undefined,
      prepareWorkflowRepositories: async () => undefined,
      generateWorkflowRepositoryGrounding: async () => undefined,
      buildWorkflowRepositoryPath: () => '/tmp/flowx-prototype-test',
    } as never, {} as never, { normalizeAiProvider: () => 'codex' } as never, {} as never, {} as never, {} as never);
    const automatic = new PrototypeImportsService(prisma as never, { get: () => executor } as never, { normalizeAiProvider: () => 'codex', resolveInvocationContext: async () => ({}) } as never, workflow);
    Object.assign(automatic, { archive });
    const surfaces = vi.spyOn(PrototypeArchive.prototype, 'surfaces').mockResolvedValue([]);
    try {
      const imported = await automatic.create({ projectId: project }, Buffer.from('zip'), 'auto.zip', actor());
      await vi.waitFor(async () => expect(await automatic.get(imported.id, actor())).toMatchObject({ status: 'CONFIRMED', workflowRunId: expect.any(String) }));
      const completed = await automatic.get(imported.id, actor());
      expect(completed.confirmedBy).toBeNull();
      expect(completed.answers).toEqual({});
      expect(completed.analysis?.brief.openQuestions).toContain('谁可以删除事项？');
      const req = await prisma.requirement.findUniqueOrThrow({ where: { id: imported.requirementId }, include: { ideationArtifacts: true, workflowRuns: true } });
      expect(req.ideationStatus).toBe('FINALIZED');
      expect(req.ideationArtifacts).toHaveLength(2);
      expect(req.workflowRuns).toHaveLength(1);
      await vi.waitFor(async () => expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: req.workflowRuns[0].id } })).status).toBe('SPEC_PLAN_PENDING'));
      await expect(automatic.analyze(imported.id, { revision: completed.revision }, actor())).rejects.toMatchObject({ status: 409 });
    } finally { surfaces.mockRestore(); }
  });
});
