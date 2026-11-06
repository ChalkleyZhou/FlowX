import { Prisma } from '@prisma/client';
import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import type { PrismaService } from '../prisma/prisma.service';

export function queryValues(value?: string | string[]) { return typeof value === 'string' ? value.split(',').filter(Boolean) : value?.flatMap(item => item.split(',')).filter(Boolean); }
export type ReportBrowseQuery = PaginationQuery & { selectedRunIds?: string | string[]; q?: string };

export async function listReportBaselines(prisma: PrismaService, id: string, query: ReportBrowseQuery) {
  const paging = parsePagination(query);
  const ids = queryValues(query.selectedRunIds);
  const selected = ids?.length ? Prisma.sql`AND r.id IN (${Prisma.join(ids)})` : Prisma.empty;
  const rows = Prisma.sql`SELECT DISTINCT json_extract(j.value, '$.workflowRepositoryId') AS workflowRepositoryId, json_extract(j.value, '$.branch') AS branch, json_extract(j.value, '$.headSha') AS headSha
    FROM TestRunTarget t JOIN TestRun r ON r.id = t.testRunId JOIN TestPlan p ON p.id = r.testPlanId, json_each(t.expectedRevisions) j
    WHERE p.testRequestId = ${id} ${selected} AND json_type(j.value, '$.workflowRepositoryId') = 'text' AND json_type(j.value, '$.branch') = 'text' AND json_type(j.value, '$.headSha') = 'text'`;
  const [items, count] = await Promise.all([
    prisma.$queryRaw<Array<{ workflowRepositoryId: string; branch: string; headSha: string }>>(Prisma.sql`SELECT * FROM (${rows}) ORDER BY workflowRepositoryId, branch, headSha LIMIT ${paging.take} OFFSET ${paging.skip}`),
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total FROM (${rows})`),
  ]);
  return pageResult(items, Number(count[0]?.total ?? 0), paging);
}

export async function listReportSupersessions(prisma: PrismaService, id: string, query: ReportBrowseQuery) {
  const paging = parsePagination(query);
  const ids = queryValues(query.selectedRunIds);
  const selected = ids?.length ? Prisma.sql`AND previous.id IN (${Prisma.join(ids)}) AND regression.id IN (${Prisma.join(ids)})` : Prisma.empty;
  const rows = Prisma.sql`SELECT previous.id AS previousRunId, regression.id AS regressionRunId, priorCase.id AS testRunCaseId, snapshot.title AS label
    FROM TestRun regression JOIN TestPlan p ON p.id = regression.testPlanId
    JOIN TestRun previous ON previous.testPlanId = regression.testPlanId AND previous.id != regression.id
    JOIN TestRunCase priorCase ON priorCase.testRunId = previous.id
    JOIN TestResult priorResult ON priorResult.testRunCaseId = priorCase.id AND priorResult.bugId = regression.sourceBugId
    JOIN TestRunCase regressionCase ON regressionCase.testRunId = regression.id AND regressionCase.snapshotId = priorCase.snapshotId
    JOIN TestResult regressionResult ON regressionResult.testRunCaseId = regressionCase.id
    JOIN TestCaseSnapshot snapshot ON snapshot.id = priorCase.snapshotId
    JOIN Bug bug ON bug.id = regression.sourceBugId JOIN WorkflowRun fix ON fix.id = bug.fixWorkflowRunId
    LEFT JOIN TestRunTarget oldTarget ON oldTarget.id = priorCase.targetId LEFT JOIN TestRunTarget newTarget ON newTarget.id = regressionCase.targetId
    WHERE p.testRequestId = ${id} AND regression.runType = 'REGRESSION' AND priorResult.result IN ('FAILED', 'BLOCKED')
    AND previous.status IN ('PASSED', 'FAILED', 'BLOCKED') AND regression.status IN ('PASSED', 'FAILED', 'BLOCKED') AND lower(fix.status) = 'done'
    AND coalesce(oldTarget.key, '') = coalesce(newTarget.key, '') ${selected}`;
  const [items, count] = await Promise.all([
    prisma.$queryRaw<Array<{ previousRunId: string; regressionRunId: string; testRunCaseId: string; label: string }>>(Prisma.sql`SELECT * FROM (${rows}) ORDER BY previousRunId, regressionRunId, testRunCaseId LIMIT ${paging.take} OFFSET ${paging.skip}`),
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total FROM (${rows})`),
  ]);
  return pageResult(items.map(({ testRunCaseId, ...row }) => ({ ...row, testRunCaseIds: [testRunCaseId] })), Number(count[0]?.total ?? 0), paging);
}

export async function listRequestCases(prisma: PrismaService, id: string, query: PaginationQuery & { result?: string; q?: string; selectedRunIds?: string | string[] }) {
  const paging = parsePagination(query);
  const results = queryValues(query.result);
  const ids = queryValues(query.selectedRunIds);
  const where: Prisma.TestRunCaseWhereInput = {
    testRun: { testPlan: { testRequestId: id }, ...(ids?.length ? { id: { in: ids } } : {}) },
    ...(results?.length ? { result: { result: { in: results } } } : {}),
    ...(query.q?.trim() ? { snapshot: { title: { contains: query.q.trim() } } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.testRunCase.findMany({ where, include: { snapshot: true, target: true, testRun: { select: { id: true, name: true, status: true, runType: true } }, result: { include: { bug: { include: { fixWorkflowRun: { select: { id: true, status: true } } } } } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: paging.skip, take: paging.take }),
    prisma.testRunCase.count({ where }),
  ]);
  return pageResult(items, total, paging);
}
