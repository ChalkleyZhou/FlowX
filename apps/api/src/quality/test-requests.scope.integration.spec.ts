import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TestRequestsService } from './test-requests.service';
import { CaseLibrariesService } from './case-libraries.service';

const directory = mkdtempSync(join(tmpdir(), 'flowx-scope-workbench-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const service = new TestRequestsService(prisma as never, {} as never);
const caseLibraries = new CaseLibrariesService(prisma as never);
let revision = 0;
let workspaceId: string;
let projectId: string;
let projectVersionId: string;

beforeAll(async () => {
  const cli = createRequire(resolve('package.json')).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  const organization = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: randomUUID(), name: '范围测试' } });
  workspaceId = (await prisma.workspace.create({ data: { organizationId: organization.id, name: '空间' } })).id;
  projectId = (await prisma.project.create({ data: { workspaceId, name: '项目' } })).id;
  projectVersionId = (await prisma.projectVersion.create({ data: { projectId, name: 'v1' } })).id;
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

async function fixture() {
  const design = await prisma.testDesign.create({ data: { workspaceId, projectId, projectVersionId, revision: ++revision, sourceFingerprint: randomUUID(), sourceSummary: {}, status: 'WAITING_REVIEW' } });
  const request = await prisma.testRequest.create({ data: { workspaceId, projectId, projectVersionId, testDesignId: design.id, title: '提测', traceId: randomUUID() } });
  const library = await prisma.testCaseLibrary.create({ data: { workspaceId, projectId, scope: 'PROJECT', name: `项目库${revision}` } });
  const module = await prisma.testCaseModule.create({ data: { libraryId: library.id, name: '登录模块' } });
  const definition = await prisma.testCaseDefinition.create({ data: { libraryId: library.id, moduleId: module.id, title: '登录', steps: ['登录'], expected: '成功' } });
  await service.addScopeDraftCases(request.id, { selections: [{ caseId: definition.id, reason: '人工补充提测范围', impactLevel: 'MEDIUM' }] });
  const candidate = await prisma.testDesignCandidate.findFirstOrThrow({ where: { testDesignId: design.id, sourceDefinitionId: definition.id } });
  return { design, request, library, module, definition, candidate };
}

it('移除后重新查询不再纳入；全部用例保持未选，重新补选恢复且不重复创建', async () => {
  const { request, definition, candidate } = await fixture();
  await service.updateScopeDraft(request.id, { scopeRevision: 1, removedCandidateIds: [candidate.id] });
  const scope = await service.getScopeDraft(request.id, { view: 'selected' });
  expect(scope.items).toHaveLength(0);
  expect(scope.summary).toMatchObject({ included: 0 });
  expect('designStatus' in scope && scope.designStatus).toBe('WAITING_REVIEW');
  const all = await service.getScopeDraft(request.id, { view: 'library' });
  expect(all.items.find(item => item.sourceDefinitionId === definition.id)).toMatchObject({ resolution: 'REJECTED' });
  await service.addScopeDraftCases(request.id, { selections: [{ caseId: definition.id, reason: '恢复范围', impactLevel: 'MEDIUM' }] });
  expect((await service.getScopeDraft(request.id, { view: 'selected' })).items).toHaveLength(1);
  expect(await prisma.testDesignCandidate.count({ where: { testDesignId: candidate.testDesignId } })).toBe(1);
  expect(await prisma.testRequestScopeCase.findFirst({ where: { testRequestId: request.id, sourceDefinitionId: definition.id } })).toMatchObject({ status: 'INCLUDED' });
});

it('AI 新用例可撤销移除，恢复幂等，过期 revision 拒绝且不改状态', async () => {
  const { request, design } = await fixture();
  const candidate = await prisma.testDesignCandidate.create({ data: { testDesignId: design.id, action: 'CREATE', coverageKeys: [], proposedCase: { title: 'AI 新增', priority: 'P1', steps: ['执行'], expected: '成功' } } });
  await service.updateScopeDraft(request.id, { scopeRevision: 1, removedCandidateIds: [candidate.id] });
  await service.updateScopeDraft(request.id, { scopeRevision: 2, removedCandidateIds: [], restoredCandidateIds: [candidate.id] });
  await service.updateScopeDraft(request.id, { scopeRevision: 3, removedCandidateIds: [], restoredCandidateIds: [candidate.id] });
  await expect(service.updateScopeDraft(request.id, { scopeRevision: 2, removedCandidateIds: [candidate.id] })).rejects.toMatchObject({ status: 409 });
  expect(await prisma.testDesignCandidate.findUnique({ where: { id: candidate.id } })).toMatchObject({ resolution: 'ACCEPTED', action: 'CREATE' });
});

it('完整模块包含子模块和第二页；移除和重新纳入保持候选与范围状态一致', async () => {
  const { request, module, library, design } = await fixture();
  const child = await prisma.testCaseModule.create({ data: { libraryId: library.id, parentId: module.id, name: '子模块' } });
  await prisma.testCaseDefinition.createMany({ data: Array.from({ length: 104 }, (_, i) => ({ libraryId: library.id, moduleId: child.id, title: `登录${i}`, steps: ['执行'], expected: '通过' })) });
  await service.updateScopeModule(request.id, { scopeRevision: 1, moduleId: module.id, included: true });
  const scope = await service.getScopeDraft(request.id, { view: 'selected', moduleId: module.id, page: 2, pageSize: 20 });
  expect(scope.total).toBe(105);
  expect(scope.items).toHaveLength(20);
  expect(scope.summary).toMatchObject({ included: 105, matchingIncluded: 105, available: 105 });
  await service.updateScopeModule(request.id, { scopeRevision: 2, moduleId: module.id, included: false });
  expect(await prisma.testDesignCandidate.count({ where: { testDesignId: design.id, resolution: { not: 'REJECTED' } } })).toBe(0);
  expect(await prisma.testRequestScopeCase.count({ where: { testRequestId: request.id, status: 'INCLUDED' } })).toBe(0);
  await service.updateScopeModule(request.id, { scopeRevision: 3, moduleId: module.id, included: true });
  expect(await prisma.testDesignCandidate.count({ where: { testDesignId: design.id } })).toBe(105);
  expect(await prisma.testRequestScopeCase.count({ where: { testRequestId: request.id, status: 'INCLUDED' } })).toBe(105);
});

it('纳入 AI 推荐只恢复已存在的 AI 候选，不创建未推荐的库内用例', async () => {
  const { request, module, candidate, definition } = await fixture();
  const libraryOnly = await prisma.testCaseDefinition.create({ data: { libraryId: definition.libraryId, moduleId: module.id, title: '库内未推荐', steps: ['执行'], expected: '通过' } });
  await service.updateScopeDraft(request.id, { scopeRevision: 1, removedCandidateIds: [candidate.id] });
  await service.updateScopeModule(request.id, { scopeRevision: 2, moduleId: module.id, included: true, strategy: 'AI_RECOMMENDED' });
  expect(await prisma.testDesignCandidate.findUnique({ where: { id: candidate.id } })).toMatchObject({ resolution: 'ACCEPTED', action: 'REUSE' });
  expect(await prisma.testDesignCandidate.findFirst({ where: { testDesignId: candidate.testDesignId, sourceDefinitionId: libraryOnly.id } })).toBeNull();
  expect(await prisma.testRequestScopeCase.count({ where: { testRequestId: request.id, status: 'INCLUDED' } })).toBe(1);
});

it('例外视图返回待审阅候选，模块摘要统计完整后代范围', async () => {
  const { request, library, module, design } = await fixture();
  await prisma.testDesignCandidate.create({ data: { testDesignId: design.id, action: 'CREATE', resolution: 'PENDING', coverageKeys: [], proposedCase: { title: 'AI 新增', priority: 'P1', steps: ['执行'], expected: '成功' } } });
  const exceptions = await service.getScopeDraft(request.id, { view: 'exceptions' });
  expect(exceptions).toMatchObject({ summary: { exceptionCount: 1 } });
  expect(exceptions.items).toEqual(expect.arrayContaining([expect.objectContaining({ exceptionReason: 'AI_NEW_CASE' })]));
  const modules = await caseLibraries.listModules(library.id, { testRequestId: request.id, parentId: 'null' });
  expect(modules.items[0]).toMatchObject({ scopeSummary: { totalCount: 1, includedCount: 1, aiRecommendedCount: 1, status: 'ALL' } });
  expect(module.id).toBe(modules.items[0].id);
});

it('跨项目模块与用例不允许纳入，确认快照后仍为 DRAFT 也不允许删改', async () => {
  const { request, design, candidate, definition, module: currentModule } = await fixture();
  const otherProject = await prisma.project.create({ data: { workspaceId, name: '其它项目' } });
  const library = await prisma.testCaseLibrary.create({ data: { workspaceId, projectId: otherProject.id, scope: 'PROJECT', name: '其它库' } });
  const module = await prisma.testCaseModule.create({ data: { libraryId: library.id, name: '其它模块' } });
  await expect(service.updateScopeModule(request.id, { scopeRevision: 1, moduleId: module.id, included: true })).rejects.toMatchObject({ status: 400 });
  const otherCase = await prisma.testCaseDefinition.create({ data: { libraryId: library.id, moduleId: module.id, title: '其它用例', steps: [], expected: '通过' } });
  await expect(service.addScopeDraftCases(request.id, { selections: [{ caseId: otherCase.id, reason: '越权', impactLevel: 'MEDIUM' }] })).rejects.toMatchObject({ status: 400 });
  const plan = await prisma.testPlan.create({ data: { testRequestId: request.id, testDesignId: design.id } });
  await prisma.testCaseSnapshot.create({ data: { testPlanId: plan.id, title: definition.title, priority: 'P1', steps: [], expected: '通过' } });
  await expect(service.updateScopeDraft(request.id, { scopeRevision: 1, removedCandidateIds: [candidate.id] })).rejects.toMatchObject({ status: 409 });
  await expect(service.updateScopeModule(request.id, { scopeRevision: 1, moduleId: currentModule.id, included: false })).rejects.toMatchObject({ status: 409 });
  const emptyModule = await prisma.testCaseModule.create({ data: { libraryId: currentModule.libraryId, name: '空模块' } });
  await expect(service.updateScopeModule(request.id, { scopeRevision: 1, moduleId: emptyModule.id, included: true })).rejects.toMatchObject({ status: 409 });
});

it('真实 HTTP 校验视图和写入 DTO，恢复与模块路由透传版本并拒绝过期写入', async () => {
  const { Module, ValidationPipe } = await import('@nestjs/common');
  const { NestFactory } = await import('@nestjs/core');
  const { TestRequestsController } = await import('./test-requests.controller');
  const { UpdateTestRequestScopeDraftDto, UpdateTestScopeModuleDto, AddTestScopeCasesDto } = await import('./dto/test-request.dto');
  Reflect.defineMetadata('design:paramtypes', [TestRequestsService], TestRequestsController);
  Reflect.defineMetadata('design:paramtypes', [String, UpdateTestRequestScopeDraftDto], TestRequestsController.prototype, 'updateScopeDraft');
  Reflect.defineMetadata('design:paramtypes', [String, UpdateTestScopeModuleDto, Object], TestRequestsController.prototype, 'updateScopeModule');
  Reflect.defineMetadata('design:paramtypes', [String, AddTestScopeCasesDto, Object], TestRequestsController.prototype, 'addScopeDraftCases');
  @Module({ controllers: [TestRequestsController], providers: [{ provide: TestRequestsService, useValue: service }] }) class ScopeModule {}
  const app = await NestFactory.create(ScopeModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  try {
    const { request, module, candidate, definition } = await fixture();
    const base = `${await app.getUrl()}/quality/test-requests/${request.id}/scope-draft`;
    const write = (path: string, body: unknown, method = 'PATCH') => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await write('/module', { moduleId: module.id, included: true })).status).toBe(400);
    expect((await write('/module', { scopeRevision: 1, moduleId: module.id, included: 'false' })).status).toBe(400);
    expect((await write('/module', { scopeRevision: 1, moduleId: module.id, included: true, strategy: 'BAD' })).status).toBe(400);
    expect((await write('', { scopeRevision: 1, removedCandidateIds: [], restoredCandidateIds: 'bad' })).status).toBe(400);
    expect((await fetch(`${base}?view=unsupported`)).status).toBe(400);
    expect((await write('', { scopeRevision: 1, removedCandidateIds: [candidate.id] })).status).toBe(200);
    const selected = await (await fetch(`${base}?view=selected&page=1&pageSize=20`)).json();
    expect(selected).toMatchObject({ scopeRevision: 2, total: 0, items: [], summary: { included: 0 } });
    const restored = await write('', { scopeRevision: 2, removedCandidateIds: [], restoredCandidateIds: [candidate.id] });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ scopeRevision: 3 });
    expect((await write('/module', { scopeRevision: 2, moduleId: module.id, included: false })).status).toBe(409);
    expect((await write('/module', { scopeRevision: 3, moduleId: module.id, included: false })).status).toBe(200);
    // 保留旧客户端不传 scopeRevision 的补选契约。
    expect((await write('/cases', { selections: [{ caseId: definition.id, reason: '旧请求恢复', impactLevel: 'MEDIUM' }] }, 'POST')).status).toBe(201);
    const library = await (await fetch(`${base}?view=library&moduleId=${module.id}&page=1&pageSize=20`)).json();
    expect(library).toMatchObject({ total: 1, summary: { included: 1 }, items: [{ id: candidate.id, resolution: 'ACCEPTED' }] });
  } finally { await app.close(); }
}, 15_000);
