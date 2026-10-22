import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { LocalSmokeCompletionReport, LocalSmokeResult } from '@flowx-ai/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalSmokeService } from './local-smoke.service';

// 两个连接模拟同一服务的数据竞争；此测试不代表真实跨设备执行。
const directory = mkdtempSync(join(tmpdir(), 'flowx-local-smoke-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const peerPrisma = new PrismaClient({ datasources: { db: { url } } });
const service = new LocalSmokeService(prisma as never, {} as never);
const peerService = new LocalSmokeService(peerPrisma as never, {} as never);
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
    traceId: randomUUID(), status: 'DRAFT', scopeGenerationStatus: 'COMPLETED',
  } });
  const plan = await prisma.testPlan.create({ data: { testRequestId: request.id } });
  const snapshots = [];
  for (let index = 0; index < caseCount; index++) {
    snapshots.push(await prisma.testCaseSnapshot.create({ data: {
      testPlanId: plan.id, title: `冒烟用例 ${index + 1}`, priority: 'P0',
      kind: 'SMOKE', steps: ['执行关键路径'], expected: '关键路径通过',
    } }));
  }
  const run = await prisma.testRun.create({ data: {
    testPlanId: plan.id, name: '本地冒烟', runType: 'LOCAL_SMOKE',
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

type Claim = Awaited<ReturnType<LocalSmokeService['claim']>>;
function completion(claim: Claim, result: LocalSmokeResult = 'PASSED'): LocalSmokeCompletionReport {
  return {
    idempotencyKey: randomUUID(), sourceFingerprint: claim.sourceFingerprint!,
    testedRevisions: revisions,
    caseResults: claim.cases.map((item) => ({ testRunCaseId: item.id, result, actualResult: `实际结果 ${result}` })),
  };
}

describe('本地冒烟多人协作真实 SQLite 链路', () => {
  it('两人同时领取相同 target/case 只有一个成功，竞争方明确收到 409 且不留孤儿会话', async () => {
    const { run, targets: [target] } = await smokeRun();
    const dto = { targetId: target.id, caseIds: [target.cases[0].id] };
    const results = await Promise.allSettled([
      service.claim(run.id, dto, userA), peerService.claim(run.id, dto, userB),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason.getStatus?.()).toBe(409);
    expect(await prisma.testExecution.count({ where: { testRunId: run.id, status: 'RUNNING' } })).toBe(1);
    expect(await prisma.executionSession.count({ where: { testRunId: run.id } })).toBe(1);
    expect(await prisma.testRunCaseLease.count({ where: { testRunCaseId: target.cases[0].id } })).toBe(1);
  });

  it.each(['target', 'case'] as const)('互不重叠的 %s 可被两人同时领取', async (partition) => {
    const { run, targets } = await smokeRun(2, ['web', 'api']);
    const left = targets[0];
    const right = partition === 'target' ? targets[1] : targets[0];
    const claims = await Promise.all([
      service.claim(run.id, { targetId: left.id, caseIds: [left.cases[0].id] }, userA),
      peerService.claim(run.id, { targetId: right.id, caseIds: [right.cases[1].id] }, userB),
    ]);
    expect(new Set(claims.map((claim) => claim.executionSessionId)).size).toBe(2);
    expect(await prisma.testExecution.count({ where: { testRunId: run.id, status: 'RUNNING' } })).toBe(2);
    expect(await prisma.testRunCaseLease.count({ where: { testExecution: { testRunId: run.id } } })).toBe(2);
  });

  it('拒绝其他人回传，原领取人同幂等键重试不重复原始结果和 evidence', async () => {
    const { run, targets: [target] } = await smokeRun();
    const claim = await service.claim(run.id, { targetId: target.id }, userA);
    const report = completion(claim);
    await expect(peerService.complete(claim.executionSessionId, report, { organizationId, userId: userB })).rejects.toMatchObject({ status: 403 });
    expect(await prisma.testExecutionCaseResult.count({ where: { testExecutionId: claim.testExecutionId } })).toBe(0);
    expect(await prisma.evidence.count({ where: { executionSessionId: claim.executionSessionId } })).toBe(0);
    expect((await prisma.executionSession.findUniqueOrThrow({ where: { id: claim.executionSessionId } })).status).toBe('RUNNING');
    await service.complete(claim.executionSessionId, report, { organizationId, userId: userA });
    const originalResult = await prisma.testExecutionCaseResult.findFirstOrThrow({ where: { testExecutionId: claim.testExecutionId } });
    const originalEvidence = await prisma.evidence.findFirstOrThrow({ where: { executionSessionId: claim.executionSessionId } });
    await peerService.complete(claim.executionSessionId, report, { organizationId, userId: userA });
    expect(await prisma.testExecutionCaseResult.findMany({ where: { testExecutionId: claim.testExecutionId } })).toEqual([originalResult]);
    expect(await prisma.evidence.findMany({ where: { executionSessionId: claim.executionSessionId } })).toEqual([originalEvidence]);
    expect(await prisma.testRunCaseLease.count({ where: { testExecutionId: claim.testExecutionId } })).toBe(0);
  });

  it('同一 case 可在新执行中再领取，FAILED 优先聚合且后续 PASSED 不覆盖失败原始证据', async () => {
    const { run, targets: [target] } = await smokeRun();
    for (const [userId, result] of [[userA, 'PASSED'], [userB, 'FAILED'], [userA, 'PASSED']] as const) {
      const claim = await service.claim(run.id, { targetId: target.id }, userId);
      await service.complete(claim.executionSessionId, completion(claim, result), { organizationId, userId });
    }
    expect(await prisma.testExecutionCaseResult.count({ where: { testRunCaseId: target.cases[0].id } })).toBe(3);
    expect(await prisma.testResult.findUniqueOrThrow({ where: { testRunCaseId: target.cases[0].id } })).toMatchObject({ result: 'FAILED', executedByUserId: userB, actualResult: '实际结果 FAILED' });
    expect((await prisma.testRunTarget.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('FAILED');
  });

  it('旧 testedRevision 回传被标记 STALE，释放租约且不覆盖已确认的结果', async () => {
    const { run, targets: [target] } = await smokeRun();
    const initial = await service.claim(run.id, { targetId: target.id }, userA);
    await service.complete(initial.executionSessionId, completion(initial), { organizationId, userId: userA });
    const confirmed = await prisma.testResult.findUniqueOrThrow({ where: { testRunCaseId: target.cases[0].id } });
    const stale = await peerService.claim(run.id, { targetId: target.id }, userB);
    const report = { ...completion(stale, 'FAILED'), testedRevisions: [{ ...revisions[0], headSha: 'cafebabe' }] };
    await expect(peerService.complete(stale.executionSessionId, report, { organizationId, userId: userB })).resolves.toEqual({ status: 'STALE', reason: 'TESTED_REVISIONS_MISMATCH' });
    expect((await prisma.testExecution.findUniqueOrThrow({ where: { id: stale.testExecutionId } })).status).toBe('STALE');
    expect(await prisma.testResult.findUniqueOrThrow({ where: { testRunCaseId: target.cases[0].id } })).toEqual(confirmed);
    expect(await prisma.testExecutionCaseResult.count({ where: { testExecutionId: stale.testExecutionId } })).toBe(0);
    expect(await prisma.testRunCaseLease.count({ where: { testExecutionId: stale.testExecutionId } })).toBe(0);
    expect((await prisma.testRunTarget.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('PASSED');
  });

  it('用例均已通过仍不能在其他执行持有效 lease 时 finalize', async () => {
    const { run, request, targets: [target] } = await smokeRun();
    const initial = await service.claim(run.id, { targetId: target.id }, userA);
    await service.complete(initial.executionSessionId, completion(initial), { organizationId, userId: userA });
    const active = await peerService.claim(run.id, { targetId: target.id }, userB);
    await expect(service.finalize(run.id, userA)).rejects.toMatchObject({
      status: 409, response: { code: 'LOCAL_SMOKE_EXECUTIONS_ACTIVE', testExecutionIds: [active.testExecutionId] },
    });
    expect((await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('ACTIVE');
    expect((await prisma.testRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('DRAFT');
    expect(await prisma.testRequestArtifact.count({ where: { testRequestId: request.id } })).toBe(0);
    expect(await prisma.testRunCaseLease.count({ where: { testExecutionId: active.testExecutionId } })).toBe(1);
  });
});
