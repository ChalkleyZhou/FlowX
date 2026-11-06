import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestReportsService } from './test-reports.service';
import { EdgeTasksService } from '../edge/edge-tasks.service';
import { TestRequestsController } from './test-requests.controller';
import { TestRequestsService } from './test-requests.service';
import { TestRunsController } from './test-runs.controller';
import { TestRunsService } from './test-runs.service';
import { CaseLibrariesController } from './case-libraries.controller';
import { CaseLibrariesService } from './case-libraries.service';
import { LocalTestRunsController } from './local-test-runs.controller';
import { LocalTestRunsService } from './local-test-runs.service';
import { TestDesignsController } from './test-designs.controller';
import { TestDesignsService } from './test-designs.service';

const directory = mkdtempSync(join(tmpdir(), 'flowx-quality-pagination-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const requests = new TestRequestsService(prisma as never, {} as never);
const runs = new TestRunsService(prisma as never);
const libraries = new CaseLibrariesService(prisma as never);
const localRuns = new LocalTestRunsService(prisma as never, {} as never);
const designs = new TestDesignsService(prisma as never, {} as never, {} as never);
const entries = [
  [TestRequestsController, TestRequestsService, requests],
  [TestRunsController, TestRunsService, runs],
  [CaseLibrariesController, CaseLibrariesService, libraries],
  [LocalTestRunsController, LocalTestRunsService, localRuns],
  [TestDesignsController, TestDesignsService, designs],
] as const;
for (const [controller, service] of entries) Reflect.defineMetadata('design:paramtypes', [service], controller);
@Module({ controllers: entries.map(([controller]) => controller), providers: entries.map(([, provide, useValue]) => ({ provide, useValue })) })
class HttpTestModule {}
let app: INestApplication;
let base: string;
let workspaceId: string;
let projectId: string;
let requestId: string;
let runId: string;
let designId: string;
let libraryId: string;

beforeAll(async () => {
  const cli = createRequire(resolve('package.json')).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  const org = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: randomUUID(), name: '分页测试' } });
  workspaceId = (await prisma.workspace.create({ data: { name: '空间', organizationId: org.id } })).id;
  projectId = (await prisma.project.create({ data: { name: '项目', workspaceId } })).id;
  const version = await prisma.projectVersion.create({ data: { projectId, name: 'v1' } });
  libraryId = (await prisma.testCaseLibrary.create({ data: { workspaceId, name: '回归库', scope: 'WORKSPACE' } })).id;
  for (let index = 0; index < 25; index++) {
    await prisma.testCaseModule.create({ data: { libraryId, name: `模块 ${index}`, sortOrder: index } });
    await prisma.testCaseDefinition.create({ data: { libraryId, title: `分页用例 ${index}`, priority: 'P0', steps: ['执行'], expected: '成功' } });
    const request = await prisma.testRequest.create({ data: { title: `提测 ${index}`, workspaceId, projectId, projectVersionId: version.id, traceId: randomUUID() } });
    const plan = await prisma.testPlan.create({ data: { testRequestId: request.id } });
    const run = await prisma.testRun.create({ data: { testPlanId: plan.id, name: `功能轮次 ${index}`, runType: 'INITIAL', executionMode: 'LOCAL' } });
    await prisma.testRunTarget.create({ data: { testRunId: run.id, key: 'web', name: 'Web', expectedRevisions: [{ workflowRepositoryId: 'repo', branch: `branch-${index}`, headSha: `sha-${index}` }] } });
    if (index === 0) {
      requestId = request.id; runId = run.id;
      for (let position = 0; position < 25; position++) {
        const snapshot = await prisma.testCaseSnapshot.create({ data: { testPlanId: plan.id, title: `快照 ${position}`, priority: 'P0', steps: ['执行'], expected: '成功' } });
        await prisma.testRunCase.create({ data: { testRunId: run.id, snapshotId: snapshot.id, sortOrder: position } });
      }
    }
  }
  designId = (await prisma.testDesign.create({ data: { workspaceId, projectId, projectVersionId: version.id, sourceFingerprint: 'test', sourceSummary: {} } })).id;
  for (let index = 0; index < 25; index++) await prisma.testDesignCandidate.create({ data: { testDesignId: designId, action: 'CREATE', coverageKeys: [], sortOrder: index, proposedCase: { title: `候选 ${index}` } } });
  await prisma.testDesign.update({ where: { id: designId }, data: { status: 'WAITING_REVIEW' } });
  for (let index = 0; index < 25; index++) await prisma.testDesignSmokeCase.create({ data: { testDesignId: designId, title: `冒烟 ${index}`, steps: ['执行'], expected: '成功', coverageKeys: [], sortOrder: index } });
  for (let index = 0; index < 13; index++) {
    await prisma.requirement.create({ data: { title: `混合需求 ${index}`, description: '内容', acceptanceCriteria: '完成', workspaceId, projectId, updatedAt: new Date(1_700_000_000_000 + index * 2000) } });
    await prisma.bug.create({ data: { title: `混合缺陷 ${index}`, description: '内容', workspaceId, projectId, updatedAt: new Date(1_700_000_001_000 + index * 2000) } });
  }
  app = await NestFactory.create(HttpTestModule, { logger: false });
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
}, 30_000);
afterAll(async () => { await app?.close(); await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
async function get(path: string) { const response = await fetch(`${base}${path}`); expect(response.status).toBe(200); return response.json(); }

it('报告分页只投影摘要，不把全部快照返回浏览列表', async () => {
  const artifact = await prisma.artifact.create({ data: { workspaceId, projectId, artifactType: 'TEST_REPORT', name: '摘要报告' } });
  await prisma.qualityTestReport.create({ data: { requestId, kind: 'REQUEST', revision: 1, artifactId: artifact.id, idempotencyKey: randomUUID(), payloadHash: 'hash', sourceFingerprint: 'fingerprint', snapshot: { mode: 'FINAL', summary: { total: 25, PASSED: 24 }, supersessions: [{ previousRunId: 'one' }], runs: [{ cases: Array.from({ length: 200 }, (_, index) => ({ id: String(index) })) }] } } });
  const result = await new TestReportsService(prisma as never, {} as never).list(requestId);
  expect(result.items[0]).toMatchObject({ mode: 'FINAL', summary: { total: 25, PASSED: 24 }, supersessionCount: 1 });
  expect(result.items[0]).not.toHaveProperty('snapshot');
});

describe('质量浏览接口的有界 HTTP / SQLite 契约', () => {
  it('提测列表默认20条且不内嵌完整快照/轮次，第二页无重复', async () => {
      const first = await get(`/quality/test-requests?projectId=${projectId}`);
    const second = await get(`/quality/test-requests?projectId=${projectId}&page=2`);
    expect(first).toMatchObject({ total: 25, page: 1, pageSize: 20, totalPages: 2 });
    expect(first.items).toHaveLength(20); expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(25);
    expect(first.items.every((item: { testPlan?: { snapshots?: unknown; runs?: unknown } }) => !item.testPlan?.snapshots && !item.testPlan?.runs)).toBe(true);
  });
  it('跨提测轮次直接分页并保留提测关联，任务发现不返回全部用例', async () => {
    const page = await get(`/quality/test-runs?projectId=${projectId}&page=2&pageSize=10`);
    expect(page).toMatchObject({ total: 25, page: 2, pageSize: 10 }); expect(page.items).toHaveLength(10);
    expect(page.items[0].testRequest.projectId).toBe(projectId);
    expect(page.items.every((item: { cases?: unknown }) => item.cases === undefined)).toBe(true);
    const tasks = await get(`/quality/local-test-tasks?projectId=${projectId}&page=2&pageSize=10`);
    expect(tasks).toMatchObject({ total: 25, page: 2, pageSize: 10 }); expect(tasks.items).toHaveLength(10);
  });
  it('回归来源按缺陷在服务端筛选，页外用例和目标摘要不会遗漏', async () => {
    const bug = await prisma.bug.create({ data: { title: '页外缺陷', description: '回归', workspaceId, projectId } });
    const source = await prisma.testRunCase.findFirstOrThrow({ where: { testRunId: runId }, orderBy: { sortOrder: 'desc' } });
    const target = await prisma.testRunTarget.findFirstOrThrow({ where: { testRunId: runId } });
    await prisma.testRunCase.update({ where: { id: source.id }, data: { targetId: target.id } });
    await prisma.testResult.create({ data: { testRunCaseId: source.id, result: 'FAILED', bugId: bug.id } });
    const page = await get(`/quality/test-runs/${runId}/cases?bugId=${bug.id}`);
    expect(page).toMatchObject({ total: 1, summary: { FAILED: 1, PENDING: 0, caseCount: 1 } });
    expect(page.items[0]).toMatchObject({ id: source.id, target: { id: target.id, key: 'web', name: 'Web' } });
    await prisma.testResult.delete({ where: { testRunCaseId: source.id } });
    await prisma.testRunCase.update({ where: { id: source.id }, data: { targetId: null } });
    await prisma.bug.delete({ where: { id: bug.id } });
  });

  it('正式用例默认分页且summary覆盖筛选后的完整范围', async () => {
    const page = await get(`/quality/test-cases?workspaceId=${workspaceId}&libraryId=${libraryId}`);
    expect(page).toMatchObject({ total: 25, pageSize: 20, totalPages: 2, summary: { p0Count: 25 } }); expect(page.items).toHaveLength(20);
    const modules = await get(`/quality/case-libraries/${libraryId}/modules?page=2&pageSize=10`);
    expect(modules).toMatchObject({ total: 25, page: 2, pageSize: 10 }); expect(modules.items).toHaveLength(10);
  });
  it('详情子列表分页，内部完整读取仍覆盖所有执行用例', async () => {
    const cases = await get(`/quality/test-runs/${runId}/cases?page=2&pageSize=10`);
    const snapshots = await get(`/quality/test-requests/${requestId}/snapshots?page=2&pageSize=10`);
    const candidates = await get(`/quality/test-designs/${designId}/candidates?page=2&pageSize=10`);
    for (const page of [cases, snapshots, candidates]) { expect(page).toMatchObject({ total: 25, page: 2, pageSize: 10 }); expect(page.items).toHaveLength(10); }
    const detail = await get(`/quality/test-runs/${runId}`); expect(detail.cases).toBeUndefined();
    expect((await localRuns.getRun(runId)).cases).toHaveLength(25);
  });
  it('按页修改冒烟项不删除其他页，拒绝未知条目', async () => {
    const first = await prisma.testDesignSmokeCase.findFirstOrThrow({ where: { testDesignId: designId } });
    const revision = (await prisma.testDesign.findUniqueOrThrow({ where: { id: designId } })).revision;
    const update = { id: first.id, title: first.title, steps: ['执行'], expected: '成功', blocking: true, coverageKeys: [], resolution: 'ACCEPTED' };
    await designs.updateSmoke(designId, { revision, partial: true, cases: [update] } as never);
    expect(await prisma.testDesignSmokeCase.count({ where: { testDesignId: designId } })).toBe(25);
    expect((await prisma.testDesignSmokeCase.findUniqueOrThrow({ where: { id: first.id } })).resolution).toBe('ACCEPTED');
    await expect(designs.updateSmoke(designId, { revision: revision + 1, partial: true, cases: [{ ...update, id: 'foreign' }] } as never)).rejects.toThrow();
  });
  it('混合需求与缺陷按统一顺序分页，跨表翻页不遗漏', async () => {
    const edge = new EdgeTasksService(prisma as never);
    const first = await edge.listTasks({ projectId, pageSize: 10 } as never);
    const second = await edge.listTasks({ projectId, pageSize: 10, page: 2 } as never);
    expect(first).toMatchObject({ total: 26, page: 1, pageSize: 10 });
    expect(first.items.map(item => item.type)).toEqual(['bug', 'requirement', 'bug', 'requirement', 'bug', 'requirement', 'bug', 'requirement', 'bug', 'requirement']);
    expect(first.items[0].title).toBe('混合缺陷 12'); expect(second.items[0].title).toBe('混合缺陷 7');
    expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(20);
  });
  it('报告基线与异常明细独立分页，可按选择的轮次限定范围', async () => {
    const baselines = await get(`/quality/test-requests/${requestId}/report-baselines?selectedRunIds=${runId}&pageSize=10`);
    expect(baselines).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(baselines.items[0]).toEqual({ workflowRepositoryId: 'repo', branch: 'branch-0', headSha: 'sha-0' });
    const cases = await get(`/quality/test-requests/${requestId}/cases?result=FAILED,BLOCKED&pageSize=10`);
    expect(cases).toMatchObject({ total: 0, items: [] });
    const supersessions = await get(`/quality/test-requests/${requestId}/report-supersessions?pageSize=10`);
    expect(supersessions).toMatchObject({ total: 0, items: [] });
  });
  it.each(['0', '-1', '1.5', '101'])('拒绝无效pageSize=%s', async pageSize => {
    expect((await fetch(`${base}/quality/test-requests?pageSize=${pageSize}`)).status).toBe(400);
  });
});
