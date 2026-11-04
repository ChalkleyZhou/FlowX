import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TestRequestsService } from './test-requests.service';
import { TestRequestsController } from './test-requests.controller';
import { CompleteTestScopeDto, PrepareTestRequestDto } from './dto/test-request.dto';

const directory = mkdtempSync(join(tmpdir(), 'flowx-quality-prepare-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const service = new TestRequestsService(prisma as never, {} as never);
let workspaceId: string; let projectId: string; let projectVersionId: string; let requirementId: string; let workflowId: string;
let revision = 0;
beforeAll(async () => {
  const cli = createRequire(resolve('package.json')).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  const org = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: randomUUID(), name: '准备测试组织' } });
  workspaceId = (await prisma.workspace.create({ data: { organizationId: org.id, name: '工作区' } })).id;
  projectId = (await prisma.project.create({ data: { workspaceId, name: '项目' } })).id;
  projectVersionId = (await prisma.projectVersion.create({ data: { projectId, name: 'v1' } })).id;
  requirementId = (await prisma.requirement.create({ data: { projectId, title: '需求', description: '准备提测', acceptanceCriteria: '通过' } })).id;
  workflowId = (await prisma.workflowRun.create({ data: { requirementId, status: 'DONE' } })).id;
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
async function requestWithSnapshot(smoke: boolean) {
  const design = await prisma.testDesign.create({ data: { workspaceId, projectId, projectVersionId, status: 'CONFIRMED', revision: ++revision, sourceFingerprint: randomUUID(), sourceSummary: {}, coverageChecks: [{ key: 'AC-1', passed: true }], uncoveredItems: ['已明确排除范围'] } });
  const request = await prisma.testRequest.create({ data: { workspaceId, projectId, projectVersionId, testDesignId: design.id, title: '冻结提测', traceId: randomUUID(), workflowLinks: { create: { workflowRunId: workflowId } } } });
  const plan = await prisma.testPlan.create({ data: { testRequestId: request.id, testDesignId: design.id } });
  await prisma.testCaseSnapshot.create({ data: { testPlanId: plan.id, title: '冻结用例', priority: 'P0', kind: smoke ? 'SMOKE' : 'FUNCTIONAL', steps: ['执行'], expected: '通过' } });
  return { request, plan, design };
}
it('真实HTTP/SQLite prepare验证scopeRevision并幂等，冒烟缺失不会使请求READY', async () => {
  Reflect.defineMetadata('design:paramtypes', [TestRequestsService], TestRequestsController);
  Reflect.defineMetadata('design:paramtypes', [String, PrepareTestRequestDto], TestRequestsController.prototype, 'prepare');
  Reflect.defineMetadata('design:paramtypes', [String, CompleteTestScopeDto], TestRequestsController.prototype, 'completeScope');
  @Module({ controllers: [TestRequestsController], providers: [{ provide: TestRequestsService, useValue: service }] }) class IntegrationModule {}
  const app = await NestFactory.create(IntegrationModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const post = (path: string, body: unknown) => fetch(`${base}/quality/test-requests/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const { request, plan } = await requestWithSnapshot(true);
    expect((await post(`${request.id}/prepare`, {})).status).toBe(400);
    expect((await post(`${request.id}/prepare`, { scopeRevision: -1 })).status).toBe(400);
    expect((await post(`${request.id}/prepare`, { scopeRevision: '0' })).status).toBe(400);
    expect((await post(`${request.id}/prepare`, { scopeRevision: 1 })).status).toBe(409);
    const first = await post(`${request.id}/prepare`, { scopeRevision: 0 });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ status: 'DRAFT', scopeGenerationStatus: 'COMPLETED', scopeRevision: 1, scopeChecks: [{ key: 'AC-1', passed: true }], excludedScopes: ['已明确排除范围'], testPlan: { status: 'READY' } });
    expect((await post(`${request.id}/prepare`, { scopeRevision: 0 })).status).toBe(201);
    expect((await post(`${request.id}/prepare`, { scopeRevision: 1 })).status).toBe(201);
    expect((await prisma.testRequest.findUniqueOrThrow({ where: { id: request.id } })).scopeRevision).toBe(1);
    expect(await prisma.testRun.count({ where: { testPlanId: plan.id } })).toBe(0);
    await expect(service.addScopeCases(request.id, { selections: [{ caseId: 'other', reason: '改范围', impactLevel: 'HIGH' }] })).rejects.toMatchObject({ status: 409 });
    await prisma.workflowRun.update({ where: { id: workflowId }, data: { status: 'EXECUTION_RUNNING' } });
    expect((await post(`${request.id}/prepare`, { scopeRevision: 1 })).status).toBe(400);
    await prisma.workflowRun.update({ where: { id: workflowId }, data: { status: 'DONE' } });
    const noSmoke = await requestWithSnapshot(false);
    expect(await (await post(`${noSmoke.request.id}/prepare`, { scopeRevision: 0 })).json()).toMatchObject({ status: 'READY', scopeRevision: 1 });
    const formalOnly = await requestWithSnapshot(true);
    await prisma.testRun.create({ data: { testPlanId: formalOnly.plan.id, name: '普通已通过轮次', runType: 'INITIAL', status: 'PASSED' } });
    expect(await (await post(`${formalOnly.request.id}/prepare`, { scopeRevision: 0 })).json()).toMatchObject({ status: 'DRAFT' });
    const smokePassed = await requestWithSnapshot(true);
    await prisma.testRun.create({ data: { testPlanId: smokePassed.plan.id, name: '已通过本地冒烟', runType: 'LOCAL_SMOKE', status: 'PASSED' } });
    expect(await (await post(`${smokePassed.request.id}/prepare`, { scopeRevision: 0 })).json()).toMatchObject({ status: 'READY' });
    const legacy = await requestWithSnapshot(true);
    const old = await post(`${legacy.request.id}/scope/complete`, { summary: '旧入口兼容', coverageChecks: [{ key: 'AC', passed: true }], excludedScopes: [] });
    expect(old.status).toBe(201);
    expect(await old.json()).toMatchObject({ status: 'DRAFT', scopeGenerationStatus: 'COMPLETED' });
  } finally { await app.close(); }
}, 15_000);
