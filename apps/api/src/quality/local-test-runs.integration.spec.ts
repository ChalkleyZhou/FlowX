import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { pathToFileURL } from 'node:url';
import { LocalTestRunsController } from './local-test-runs.controller';
import { TestReportsController } from './test-reports.controller';
import { ClaimLocalSmokeDto } from './dto/local-smoke.dto';
import { QualityExecutionReportDto, QualityControlDto, FinishQualityRunDto } from './dto/local-test-run.dto';
import { CreateRunTestReportDto } from './dto/test-report.dto';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { LocalSmokeCompletionReport, LocalSmokeResult } from '@flowx-ai/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalTestRunsService } from './local-test-runs.service';
import { TestRunsService } from './test-runs.service';
import { LocalSmokeService } from './local-smoke.service';
import { TestReportsService } from './test-reports.service';

// 两个连接模拟同一服务的数据竞争；此测试不代表真实跨设备执行。
const directory = mkdtempSync(join(tmpdir(), 'flowx-local-smoke-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const peerPrisma = new PrismaClient({ datasources: { db: { url } } });
const service = new LocalTestRunsService(prisma as never, {} as never);
const peerService = new LocalTestRunsService(peerPrisma as never, {} as never);
const revisions = [{ workflowRepositoryId: 'smoke-repository', branch: 'feature/smoke', headSha: 'deadbeef' }];
let organizationId: string;
let workspaceId: string;
let projectId: string;
let projectVersionId: string;
let userA: string;
let userB: string;

beforeAll(async () => {
  const cli = createRequire(resolve('package.json')).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  organizationId = (await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: randomUUID(), name: '冒烟协作测试组织' } })).id;
  workspaceId = (await prisma.workspace.create({ data: { name: '冒烟测试空间', organizationId } })).id;
  projectId = (await prisma.project.create({ data: { name: '冒烟测试项目', workspaceId } })).id;
  projectVersionId = (await prisma.projectVersion.create({ data: { name: 'v1', projectId } })).id;
  userA = (await prisma.user.create({ data: { displayName: '甲' } })).id;
  userB = (await prisma.user.create({ data: { displayName: '乙' } })).id;
}, 30_000);

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), peerPrisma.$disconnect()]);
  rmSync(directory, { recursive: true, force: true });
});

async function smokeRun(caseCount = 1, targetKeys = ['web']) {
  const request = await prisma.testRequest.create({ data: {
    title: '多人冒烟验证', workspaceId, projectId, projectVersionId,
    traceId: randomUUID(), status: 'IN_TEST', scopeGenerationStatus: 'COMPLETED',
  } });
  const plan = await prisma.testPlan.create({ data: { testRequestId: request.id } });
  const snapshots = [];
  for (let index = 0; index < caseCount; index++) {
    snapshots.push(await prisma.testCaseSnapshot.create({ data: {
      testPlanId: plan.id, title: `冒烟用例 ${index + 1}`, priority: 'P0',
      kind: 'FUNCTIONAL', steps: ['执行关键路径'], expected: '关键路径通过',
    } }));
  }
  const run = await prisma.testRun.create({ data: {
    testPlanId: plan.id, name: '本地冒烟', runType: 'INITIAL', executionMode: 'LOCAL',
    status: 'ACTIVE', sourceFingerprint: randomUUID(),
  } });
  const targets = [];
  for (const key of targetKeys) {
    const target = await prisma.testRunTarget.create({ data: {
      testRunId: run.id, key, name: key, expectedRevisions: revisions,
    } });
    const cases = [];
    for (const [sortOrder, snapshot] of snapshots.entries()) {
      cases.push(await prisma.testRunCase.create({ data: {
        testRunId: run.id, targetId: target.id, snapshotId: snapshot.id, sortOrder,
      } }));
    }
    targets.push({ ...target, cases });
  }
  return { run, request, targets };
}

type Claim = Awaited<ReturnType<LocalTestRunsService['claim']>>;
function completion(claim: Claim, result: LocalSmokeResult = 'PASSED'): LocalSmokeCompletionReport & { testRunRevision: number } {
  return {
    testRunRevision: claim.testRunRevision, idempotencyKey: randomUUID(), sourceFingerprint: claim.sourceFingerprint!,
    testedRevisions: revisions,
    caseResults: claim.cases.map((item) => ({ testRunCaseId: item.id, result, actualResult: `实际结果 ${result}` })),
  };
}

describe('完整本地测试真实 SQLite 链路', () => {
  it('通用会话不能借旧冒烟入口绕过租约和完成校验', async () => {
    const { run, targets: [target] } = await smokeRun(2);
    const claim = await service.claim(run.id, { targetId: target.id }, userA);
    const legacy = new LocalSmokeService(prisma as never, {} as never);
    await expect(legacy.complete(claim.executionSessionId, completion(claim), { organizationId, userId: userA })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.testResult.count({ where: { testRunCase: { testRunId: run.id } } })).toBe(0);
    expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: claim.executionSessionId } })).status).toBe('RUNNING');
  });
  it('失败结果独立关联本项目缺陷，不更改执行事实并拒绝跨项目缺陷', async () => {
    const { run, targets: [target] } = await smokeRun();
    const claim = await service.claim(run.id, { targetId: target.id }, userA);
    await service.completeTest(claim.executionSessionId, completion(claim, 'FAILED'), { organizationId, userId: userA });
    const bug = await prisma.bug.create({ data: { title: '失败项', description: '复现', workspaceId, projectId } });
    const otherProject = await prisma.project.create({ data: { name: '另一个项目', workspaceId } });
    const foreign = await prisma.bug.create({ data: { title: '异项目', description: '复现', workspaceId, projectId: otherProject.id } });
    await expect(service.linkBug(run.id, target.cases[0].id, foreign.id)).rejects.toMatchObject({ status: 400 });
    const before = await prisma.testResult.findUniqueOrThrow({ where: { testRunCaseId: target.cases[0].id } });
    await service.linkBug(run.id, target.cases[0].id, bug.id);
    const after = await prisma.testResult.findUniqueOrThrow({ where: { testRunCaseId: target.cases[0].id } });
    expect(after).toEqual({ ...before, bugId: bug.id, updatedAt: expect.any(Date) });
    expect(await prisma.testExecutionCaseResult.count({ where: { testExecutionId: claim.testExecutionId, result: 'FAILED' } })).toBe(1);
  });
  it('普通功能用例可领取并分批回传，重试幂等且内容冲突不能覆盖', async () => {
    const { run, targets: [target] } = await smokeRun(2);
    const claim = await service.claim(run.id, { targetId: target.id }, userA);
    const report = completion(claim);
    const first = { ...report, caseResults: [report.caseResults[0]] };
    await service.progress(claim.executionSessionId, first, { organizationId, userId: userA });
    await service.progress(claim.executionSessionId, first, { organizationId, userId: userA });
    expect(await prisma.testExecutionCaseResult.count({ where: { testExecutionId: claim.testExecutionId } })).toBe(1);
    await expect(service.progress(claim.executionSessionId, { ...first, summary: 'changed' }, { organizationId, userId: userA })).rejects.toMatchObject({ status: 409 });
    await expect(service.completeTest(claim.executionSessionId, { ...first, idempotencyKey: randomUUID() }, { organizationId, userId: userA })).rejects.toMatchObject({ status: 400 });
    await service.completeTest(claim.executionSessionId, { ...report, idempotencyKey: randomUUID() }, { organizationId, userId: userA });
    expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: claim.executionSessionId } })).status).toBe('COMPLETED');
    expect(await prisma.testResult.count({ where: { testRunCase: { testRunId: run.id } } })).toBe(2);
  });
  it('分批回传释放后默认只领取剩余项，旧会话不能继续写入', async () => {
    const { run, targets: [target] } = await smokeRun(2);
    const first = await service.claim(run.id, { targetId: target.id }, userA);
    const report = completion(first);
    await service.progress(first.executionSessionId, { ...report, caseResults: [report.caseResults[0]] }, { organizationId, userId: userA });
    await service.control(first.executionSessionId, 'release', { reason: '稍后继续' }, { organizationId, userId: userA });
    const next = await service.claim(run.id, { targetId: target.id }, userA);
    expect(next.cases.map(item => item.id)).toEqual([target.cases[1].id]);
    await expect(service.progress(first.executionSessionId, { ...report, idempotencyKey: randomUUID() }, { organizationId, userId: userA })).rejects.toMatchObject({ status: 409 });
    await service.completeTest(next.executionSessionId, completion(next), { organizationId, userId: userA });
    await expect(service.claim(run.id, { targetId: target.id }, userA)).rejects.toMatchObject({ status: 409 });
  });
  it('并发领取只有一人成功，原领取人才能回传，过期和取消后的结果拒绝', async () => {
    const { run, targets: [target] } = await smokeRun();
    const claims = await Promise.allSettled([service.claim(run.id, { targetId: target.id }, userA), peerService.claim(run.id, { targetId: target.id }, userB)]);
    expect(claims.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const claim = claims.find(x => x.status === 'fulfilled')!;
    if (claim.status !== 'fulfilled') throw new Error('未能领取');
    const owner = (await prisma.executionSession.findUniqueOrThrow({ where: { id: claim.value.executionSessionId } })).claimedByUserId!;
    await expect(service.progress(claim.value.executionSessionId, completion(claim.value), { organizationId, userId: owner === userA ? userB : userA })).rejects.toMatchObject({ status: 403 });
    await service.control(claim.value.executionSessionId, 'cancel', { reason: '设备已停止' }, { organizationId, userId: owner });
    await expect(service.progress(claim.value.executionSessionId, completion(claim.value), { organizationId, userId: owner })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.testResult.count({ where: { testRunCase: { testRunId: run.id } } })).toBe(0);
  });
  it('人工轮次结束不会覆盖另一个仍活动的正式轮次', async () => {
    const { run, request, targets: [target] } = await smokeRun();
    await prisma.testRun.update({ where: { id: run.id }, data: { executionMode: 'MANUAL' } });
    const parallel = await prisma.testRun.create({ data: { testPlanId: run.testPlanId, name: '并行轮次', runType: 'INITIAL', executionMode: 'LOCAL' } });
    const legacy = new TestRunsService(prisma as never);
    expect(await legacy.reportResult(target.cases[0].id, { result: 'PASSED' }, userA)).toMatchObject({ runStatus: 'PASSED', testRequestStatus: 'IN_TEST' });
    expect((await prisma.testRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('IN_TEST');
    expect((await prisma.testRun.findUniqueOrThrow({ where: { id: parallel.id } })).status).toBe('ACTIVE');
  });
  it('真实MCP经HTTP严格DTO完成四类结果的分批回传与失败报告', async () => {
    const { run, request, targets: [target] } = await smokeRun(4);
    const artifacts = { createServerGeneratedArtifact: async (input: { name: string; metadata: object }) => prisma.artifact.create({ data: { workspaceId, projectId, artifactType: 'TEST_REPORT', name: input.name, version: '1', metadata: input.metadata, status: 'AVAILABLE' } }) };
    const reports = new TestReportsService(prisma as never, artifacts as never);
    Reflect.defineMetadata('design:paramtypes', [LocalTestRunsService], LocalTestRunsController);
    Reflect.defineMetadata('design:paramtypes', [TestReportsService], TestReportsController);
    for (const [method, types] of Object.entries({ claim: [String, ClaimLocalSmokeDto, Object], progress: [String, QualityExecutionReportDto, Object], complete: [String, QualityExecutionReportDto, Object], heartbeat: [String, QualityControlDto, Object], finish: [String, FinishQualityRunDto, Object] })) Reflect.defineMetadata('design:paramtypes', types, LocalTestRunsController.prototype, method);
    Reflect.defineMetadata('design:paramtypes', [String, CreateRunTestReportDto, Object], TestReportsController.prototype, 'run');
    @Module({ controllers: [LocalTestRunsController, TestReportsController], providers: [{ provide: LocalTestRunsService, useValue: service }, { provide: TestReportsService, useValue: reports }] })
    class IntegrationModule {}
    const app = await NestFactory.create(IntegrationModule, { logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.use((req: { headers: Record<string, string>; authSession?: object }, res: { status: (status: number) => { json: (body: object) => void } }, next: () => void) => {
      if (req.headers.authorization !== 'Bearer integration-token') { res.status(401).json({ message: '未认证' }); return; }
      req.authSession = { user: { id: userA }, organization: { id: organizationId } }; next();
    });
    await app.listen(0, '127.0.0.1');
    const previous = { url: process.env.FLOWX_API_BASE_URL, token: process.env.FLOWX_API_TOKEN };
    process.env.FLOWX_API_BASE_URL = await app.getUrl(); process.env.FLOWX_API_TOKEN = 'integration-token';
    const localRequire = createRequire(resolve('../../packages/flowx-local/package.json'));
    const { Client } = await import(/* @vite-ignore */ pathToFileURL(localRequire.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
    const { InMemoryTransport } = await import(/* @vite-ignore */ pathToFileURL(localRequire.resolve('@modelcontextprotocol/sdk/inMemory.js')).href);
    // 本地包使用 NodeNext，API 使用 CommonJS；运行时加载避免跨包重复展开 MCP/Zod 泛型。
    const localMcpPath = '../../../../packages/flowx-local/src/mcp';
    const { createLocalMcpServer } = await import(localMcpPath);
    const server = createLocalMcpServer({ homeDir: join(directory, 'mcp-home') });
    const client = new Client({ name: 'quality-http-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map((tool: { name: string }) => tool.name)).toContain('flowx_submit_test_report');
      const claimed = await client.callTool({ name: 'flowx_claim_test_task', arguments: { testRunId: run.id, targetId: target.id } });
      expect(claimed.isError).not.toBe(true);
      const claim: Claim = JSON.parse(claimed.content[0].text);
      const report = completion(claim);
      report.caseResults = report.caseResults.map((item, index) => ({ ...item, result: ['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'][index] as LocalSmokeResult }));
      const first = { ...report, caseResults: report.caseResults.slice(0, 2) };
      for (let attempt = 0; attempt < 2; attempt++) expect((await client.callTool({ name: 'flowx_report_test_progress', arguments: { executionSessionId: claim.executionSessionId, report: first } })).isError).not.toBe(true);
      expect(await prisma.testExecutionCaseResult.count({ where: { testExecutionId: claim.testExecutionId } })).toBe(2);
      const conflict = await client.callTool({ name: 'flowx_report_test_progress', arguments: { executionSessionId: claim.executionSessionId, report: { ...first, summary: '内容发生变化' } } });
      expect(conflict.isError).toBe(true);
      expect((await client.callTool({ name: 'flowx_control_test_execution', arguments: { executionSessionId: claim.executionSessionId, action: 'heartbeat', leaseSeconds: 120 } })).isError).not.toBe(true);
      expect((await client.callTool({ name: 'flowx_submit_test_report', arguments: { executionSessionId: claim.executionSessionId, report: { ...report, idempotencyKey: randomUUID() } } })).isError).not.toBe(true);
      const current = await service.getRun(run.id);
      expect((await client.callTool({ name: 'flowx_finish_test_run', arguments: { testRunId: run.id, revision: current.revision, reason: '四类实际结果已回传' } })).isError).not.toBe(true);
      const generated = await client.callTool({ name: 'flowx_test_reports', arguments: { action: 'run', testRunId: run.id, idempotencyKey: 'http-final', mode: 'FINAL' } });
      expect(generated.isError).not.toBe(true);
      expect((await prisma.qualityTestReport.findFirstOrThrow({ where: { requestId: request.id } })).snapshot).toMatchObject({ summary: { total: 4, passed: 1, failed: 1, blocked: 1, skipped: 1, pending: 0, conclusion: 'FAILED' } });
      const invalid = await fetch(`${await app.getUrl()}/execution-sessions/${claim.executionSessionId}/quality/progress`, { method: 'POST', headers: { Authorization: 'Bearer integration-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...report, arbitraryField: true }) });
      expect(invalid.status).toBe(400);
    } finally {
      await client.close(); await server.close(); await app.close();
      if (previous.url === undefined) delete process.env.FLOWX_API_BASE_URL; else process.env.FLOWX_API_BASE_URL = previous.url;
      if (previous.token === undefined) delete process.env.FLOWX_API_TOKEN; else process.env.FLOWX_API_TOKEN = previous.token;
    }
  });
  it('真实修复版本回归后显式替代失败，更新当前结论并保留历史报告', async () => {
    const { run: placeholder, request, targets: [target] } = await smokeRun();
    const snapshotId = target.cases[0].snapshotId;
    await prisma.testRun.delete({ where: { id: placeholder.id } });
    await prisma.testPlan.update({ where: { id: placeholder.testPlanId }, data: { status: 'READY' } });
    const requirement = await prisma.requirement.create({ data: { title: '登录', description: '登录需求', acceptanceCriteria: '成功进入首页', workspaceId, projectId, versionId: projectVersionId } });
    const repository = await prisma.repository.create({ data: { workspaceId, name: '应用', url: 'https://example.invalid/app.git' } });
    async function delivery(branch: string, headSha: string) {
      const workflow = await prisma.workflowRun.create({ data: { requirementId: requirement.id, status: 'DONE' } });
      const repo = await prisma.workflowRepository.create({ data: { workflowRunId: workflow.id, repositoryId: repository.id, name: '应用', url: repository.url, baseBranch: 'main', workingBranch: branch } });
      const revision = { workflowRepositoryId: repo.id, branch, headSha };
      await prisma.stageExecution.create({ data: { workflowRunId: workflow.id, stage: 'EXECUTION', status: 'COMPLETED', input: { executor: 'CODE_DELIVERY' }, output: { delivery: { submissions: [revision] } } } });
      return { workflow, revision };
    }
    const original = await delivery('feature/login', 'aaaa');
    await prisma.testRequestWorkflowRun.create({ data: { testRequestId: request.id, workflowRunId: original.workflow.id } });
    const initial = await service.createTestRun(request.id, { name: '功能初测', runType: 'INITIAL', targets: [{ key: 'web', name: 'Web' }], cases: [{ snapshotId, targetKeys: ['web'] }] }, userA);
    const claim = await service.claim(initial.id, { targetId: initial.targets[0].id }, userA);
    await service.completeTest(claim.executionSessionId, { ...completion(claim, 'FAILED'), testedRevisions: [original.revision] }, { organizationId, userId: userA });
    await service.finish(initial.id, { revision: (await service.getRun(initial.id)).revision }, userA);
    const artifacts = { createServerGeneratedArtifact: async (input: { name: string; metadata: object }) => prisma.artifact.create({ data: { workspaceId, projectId, artifactType: 'TEST_REPORT', name: input.name, version: '1', metadata: input.metadata, status: 'AVAILABLE' } }) };
    const reports = new TestReportsService(prisma as never, artifacts as never);
    const oldReport = await reports.createRunReport(initial.id, { idempotencyKey: 'failed-report', mode: 'FINAL' }, userA);
    const fix = await delivery('fix/login', 'bbbb');
    const bug = await prisma.bug.create({ data: { title: '登录失败', description: '不能进入首页', workspaceId, projectId, fixWorkflowRunId: fix.workflow.id } });
    await service.linkBug(initial.id, initial.cases[0].id, bug.id);
    const regression = await service.createTestRun(request.id, { name: '缺陷回归', runType: 'REGRESSION', sourceBugId: bug.id, targets: [{ key: 'web', name: 'Web' }], cases: [{ snapshotId, targetKeys: ['web'] }] }, userA);
    expect(regression.targets[0].expectedRevisions).toEqual([fix.revision]);
    const verify = await service.claim(regression.id, { targetId: regression.targets[0].id }, userA);
    await service.completeTest(verify.executionSessionId, { ...completion(verify), testedRevisions: [fix.revision] }, { organizationId, userId: userA });
    await service.finish(regression.id, { revision: (await service.getRun(regression.id)).revision }, userA);
    expect((await prisma.testRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('FAILED');
    const dto = { idempotencyKey: 'request-final', mode: 'FINAL' as const, runIds: [initial.id, regression.id], baseline: [fix.revision], supersessions: [{ previousRunId: initial.id, regressionRunId: regression.id, testRunCaseIds: [initial.cases[0].id] }] };
    const report = await reports.createRequestReport(request.id, dto, userA);
    expect(report.snapshot).toMatchObject({ summary: { total: 1, passed: 1, conclusion: 'PASSED' } });
    expect((await prisma.testRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('PASSED');
    expect((await reports.createRequestReport(request.id, dto, userA)).id).toBe(report.id);
    await reports.createRequestReport(request.id, { idempotencyKey: 'regression-subset', mode: 'FINAL', runIds: [regression.id], baseline: [fix.revision] }, userA);
    expect((await prisma.testRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('PASSED');
    expect((await prisma.qualityTestReport.findUniqueOrThrow({ where: { id: oldReport.id } })).snapshot).toEqual(oldReport.snapshot);
    expect((await service.getRun(initial.id)).cases[0].result?.result).toBe('FAILED');
  });
  it('任务最终报告与状态均保留冻结范围中漏测用例及适用端', async () => {
    const { run, request, targets: [target] } = await smokeRun(2);
    await prisma.testRunCase.delete({ where: { id: target.cases[1].id } });
    await prisma.testCaseSnapshot.update({ where: { id: target.cases[0].snapshotId }, data: { targetKeys: ['web', 'ios'] } });
    const requirement = await prisma.requirement.create({ data: { title: '范围完整性', description: '测试', acceptanceCriteria: '完整覆盖', workspaceId, projectId, versionId: projectVersionId } });
    const workflow = await prisma.workflowRun.create({ data: { requirementId: requirement.id, status: 'DONE' } });
    const repository = await prisma.workflowRepository.create({ data: { workflowRunId: workflow.id, name: '范围仓库', url: 'https://example.invalid/scope.git', baseBranch: 'main', workingBranch: 'main' } });
    const baseline = [{ workflowRepositoryId: repository.id, branch: 'main', headSha: 'scope-sha' }];
    await prisma.testRunTarget.update({ where: { id: target.id }, data: { expectedRevisions: baseline } });
    const claim = await service.claim(run.id, { targetId: target.id }, userA);
    await service.completeTest(claim.executionSessionId, { ...completion(claim), testedRevisions: baseline }, { organizationId, userId: userA });
    await service.finish(run.id, { revision: (await service.getRun(run.id)).revision }, userA);
    const artifacts = { createServerGeneratedArtifact: async (input: { name: string; metadata: object }) => prisma.artifact.create({ data: { workspaceId, projectId, artifactType: 'TEST_REPORT', name: input.name, version: '1', metadata: input.metadata, status: 'AVAILABLE' } }) };
    const reports = new TestReportsService(prisma as never, artifacts as never);
    const report = await reports.createRequestReport(request.id, { idempotencyKey: 'incomplete-scope', mode: 'FINAL', runIds: [run.id], baseline }, userA);
    expect(report.snapshot).toMatchObject({ summary: { total: 3, passed: 1, pending: 2, conclusion: 'BLOCKED' }, untestedScopes: expect.arrayContaining([
      expect.objectContaining({ snapshotId: target.cases[0].snapshotId, targetKey: 'ios' }),
      expect.objectContaining({ snapshotId: target.cases[1].snapshotId, targetKey: null }),
    ]) });
    expect((await prisma.testRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('BLOCKED');
  });
  it('失败也可生成不可变报告，未结束租约不能关闭轮次', async () => {
    const { run, request, targets: [target] } = await smokeRun();
    const claim = await service.claim(run.id, { targetId: target.id }, userA);
    await expect(service.finish(run.id, { revision: (await service.getTasks(run.id)).revision }, userA)).rejects.toMatchObject({ status: 409 });
    await service.completeTest(claim.executionSessionId, completion(claim, 'FAILED'), { organizationId, userId: userA });
    const before = await service.getTasks(run.id);
    await service.finish(run.id, { revision: before.revision }, userA);
    const artifacts = { createServerGeneratedArtifact: async (input: { name: string; metadata: object }) => prisma.artifact.create({ data: { workspaceId, projectId, artifactType: 'TEST_REPORT', name: input.name, version: '1', metadata: input.metadata, status: 'AVAILABLE' } }) };
    const reports = new TestReportsService(prisma as never, artifacts as never);
    const dto = { idempotencyKey: 'report-1', mode: 'FINAL' as const };
    const report = await reports.createRunReport(run.id, dto, userA);
    expect(report.snapshot).toMatchObject({ summary: { failed: 1, conclusion: 'FAILED' } });
    expect((await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('FAILED');
    expect((await prisma.testRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('FAILED');
    expect((await reports.createRunReport(run.id, dto, userA)).id).toBe(report.id);
    expect(await prisma.qualityTestReport.count({ where: { requestId: request.id } })).toBe(1);
  });
});
