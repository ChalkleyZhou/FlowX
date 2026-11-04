import type { Prisma } from '@prisma/client';
import { qualityHash, qualityRecord, qualityRevisions } from './local-test-execution';
import { assertTestRequestTransition, TestRequestStatus } from './quality-status';
import { stringArray } from './test-case-selection';
import { missingQualityScopes } from './test-request-summary';
import { summarizeQualityResults } from './test-report-summary';

export const stateRunInclude = {
  targets: true,
  cases: { include: { result: true } },
} as const;
type StateRun = Prisma.TestRunGetPayload<{ include: typeof stateRunInclude }>;

// 报告 CAS 会递增 revision；使用业务事实指纹判断旧汇总是否仍适用。
export function runScopeFingerprint(run: StateRun) {
  return qualityHash({ id: run.id, status: run.status, runType: run.runType,
    targets: run.targets.map(item => ({ key: item.key, expectedRevisions: item.expectedRevisions })).sort((a, b) => a.key.localeCompare(b.key)),
    cases: run.cases.map(item => ({ id: item.id, snapshotId: item.snapshotId, targetId: item.targetId,
      result: item.result ? { result: item.result.result, bugId: item.result.bugId, actualResult: item.result.actualResult, evidence: item.result.evidence } : null,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export async function refreshTestRequestStatus(tx: Prisma.TransactionClient, requestId: string) {
  const request = await tx.testRequest.findUniqueOrThrow({ where: { id: requestId }, include: { testPlan: { include: { snapshots: true } } } });
  if (request.status === 'CANCELLED') return request.status;
  const runs = await tx.testRun.findMany({ where: { testPlan: { testRequestId: requestId }, runType: { notIn: ['LOCAL_SMOKE', 'SMOKE'] } }, include: stateRunInclude });
  if (!runs.length) return request.status;
  let next: string = runs.some(item => item.status === 'ACTIVE') ? 'IN_TEST' : summarizeQualityResults(runs.flatMap(run => run.cases.map(item => item.result?.result))).conclusion;
  let explicit = false;
  if (next !== 'IN_TEST') {
    const reports = await tx.qualityTestReport.findMany({ where: { requestId, kind: 'REQUEST' }, orderBy: { createdAt: 'desc' } });
    // 局部报告不能撤销事实仍适用的完整回归裁定。
    const applicable = reports.find(report => {
      const snapshot = qualityRecord(report.snapshot);
      const facts = qualityRecord(snapshot.scopeRunFacts);
      return Object.keys(facts).length === runs.length && runs.every(run => facts[run.id] === runScopeFingerprint(run)) && ['PASSED', 'FAILED', 'BLOCKED'].includes(String(qualityRecord(snapshot.summary).conclusion));
    });
    if (applicable) {
      next = String(qualityRecord(qualityRecord(applicable.snapshot).summary).conclusion);
      explicit = true;
    }
  }
  if (next === 'PASSED') {
    const required = (request.testPlan?.snapshots ?? []).filter(item => item.kind === 'FUNCTIONAL').map(item => ({ snapshotId: item.id, targetKeys: stringArray(item.targetKeys) }));
    const covered = runs.flatMap(run => run.cases.map(item => ({ snapshotId: item.snapshotId, targetKey: run.targets.find(target => target.id === item.targetId)?.key ?? null })));
    if (missingQualityScopes(required, covered).length) next = 'BLOCKED';
    const hasLocal = runs.some(run => run.executionMode === 'LOCAL');
    if (hasLocal && !explicit) {
      const revisions = runs.flatMap(run => run.targets.flatMap(target => qualityRevisions(target.expectedRevisions)));
      const repos = await tx.workflowRepository.findMany({ where: { id: { in: revisions.map(item => item.workflowRepositoryId) } }, select: { id: true, repositoryId: true } });
      const identities = new Map(repos.map(repo => [repo.id, repo.repositoryId ?? repo.id]));
      const versions = new Map<string, string>();
      for (const revision of revisions) {
        const key = identities.get(revision.workflowRepositoryId) ?? revision.workflowRepositoryId;
        const value = qualityHash({ branch: revision.branch, headSha: revision.headSha });
        if (versions.has(key) && versions.get(key) !== value) next = 'BLOCKED';
        versions.set(key, value);
      }
      if (runs.some(run => run.executionMode !== 'LOCAL' || !run.targets.length || run.targets.some(target => !qualityRevisions(target.expectedRevisions).length))) next = 'BLOCKED';
    }
  }
  if (request.status !== next) {
    let from = request.status as TestRequestStatus;
    if (next !== 'IN_TEST' && from !== TestRequestStatus.IN_TEST) {
      assertTestRequestTransition(from, TestRequestStatus.IN_TEST);
      await tx.testRequest.update({ where: { id: requestId }, data: { status: 'IN_TEST' } });
      from = TestRequestStatus.IN_TEST;
    }
    assertTestRequestTransition(from, next as TestRequestStatus);
    await tx.testRequest.update({ where: { id: requestId }, data: { status: next } });
  }
  return next;
}
