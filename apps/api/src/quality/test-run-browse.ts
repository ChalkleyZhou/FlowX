import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import type { PrismaService } from '../prisma/prisma.service';

export const runBrowseInclude = {
  testPlan: { include: { testRequest: { include: { project: true, projectVersion: true } } } },
  sourceBug: { include: { fixWorkflowRun: { select: { id: true, status: true } } } },
  _count: { select: { cases: true, targets: true, executions: true } },
} as const;

export async function getRunBrowse(prisma: PrismaService, id: string) {
  const run = await prisma.testRun.findUnique({ where: { id }, include: runBrowseInclude });
  if (!run) throw new NotFoundException('测试轮次不存在。');
  const groups = await prisma.testResult.groupBy({ by: ['result'], where: { testRunCase: { testRunId: id } }, _count: true });
  const summaries = await runSummaries(prisma, [id]);
  return { ...run, testRequest: run.testPlan.testRequest, summary: { ...Object.fromEntries(groups.map(group => [group.result, group._count])), ...summaries.get(id)! } };
}

export async function listRunCases(prisma: PrismaService, id: string, query: PaginationQuery & { q?: string; result?: string; targetId?: string; bugId?: string }) {
  const run = await getRunBrowse(prisma, id);
  const paging = parsePagination(query);
  const scope: Prisma.TestRunCaseWhereInput = { testRunId: id, targetId: query.targetId, ...(query.bugId ? { AND: [{ result: { bugId: query.bugId } }] } : {}), ...(query.q?.trim() ? { snapshot: { title: { contains: query.q.trim() } } } : {}) };
  const result = query.result?.toUpperCase();
  const where: Prisma.TestRunCaseWhereInput = { ...scope, ...(result ? result === 'NOT_RUN' || result === 'PENDING' ? { result: null } : { result: { result } } : {}) };
  const [items, total, resultGroups, pending] = await Promise.all([
    prisma.testRunCase.findMany({ where, include: { snapshot: true, target: { select: { id: true, key: true, name: true } }, assignedToUser: true, activeLease: true, result: { include: { bug: { include: { fixWorkflowRun: { select: { id: true, status: true } } } } } } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], skip: paging.skip, take: paging.take }),
    prisma.testRunCase.count({ where }),
    prisma.testResult.groupBy({ by: ['result'], where: { testRunCase: scope }, _count: true }),
    prisma.testRunCase.count({ where: { ...scope, result: null } }),
  ]);
  return { ...pageResult(items, total, paging), run, summary: { ...Object.fromEntries(resultGroups.map(group => [group.result, group._count])), NOT_RUN: pending, PENDING: pending, completedCount: resultGroups.reduce((sum, group) => sum + group._count, 0), caseCount: pending + resultGroups.reduce((sum, group) => sum + group._count, 0) } };
}

export async function listRunTargets(prisma: PrismaService, id: string, query: PaginationQuery) {
  await getRunBrowse(prisma, id);
  const paging = parsePagination(query);
  const where = { testRunId: id };
  const [items, total] = await Promise.all([
    prisma.testRunTarget.findMany({ where, include: { _count: { select: { cases: true, executions: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: paging.skip, take: paging.take }),
    prisma.testRunTarget.count({ where }),
  ]);
  return pageResult(items, total, paging);
}

export async function listRunExecutions(prisma: PrismaService, id: string, query: PaginationQuery) {
  await getRunBrowse(prisma, id);
  const paging = parsePagination(query);
  const where = { testRunId: id };
  const [items, total] = await Promise.all([
    prisma.testExecution.findMany({ where, include: { target: { select: { id: true, key: true, name: true } }, claimedByUser: { select: { id: true, displayName: true } }, _count: { select: { results: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: paging.skip, take: paging.take }),
    prisma.testExecution.count({ where }),
  ]);
  return pageResult(items, total, paging);
}

export async function runSummaries(prisma: PrismaService, ids: string[]) {
  if (!ids.length) return new Map<string, { caseCount: number; completedCount: number; activeLeaseCount: number }>();
  const rows = await prisma.$queryRaw<Array<{ testRunId: string; caseCount: bigint; completedCount: bigint; activeLeaseCount: bigint }>>(Prisma.sql`
    SELECT c.testRunId, COUNT(*) AS caseCount, COUNT(r.id) AS completedCount,
      SUM(CASE WHEN l.leaseExpiresAt > ${new Date()} THEN 1 ELSE 0 END) AS activeLeaseCount
    FROM TestRunCase c LEFT JOIN TestResult r ON r.testRunCaseId = c.id LEFT JOIN TestRunCaseLease l ON l.testRunCaseId = c.id
    WHERE c.testRunId IN (${Prisma.join(ids)}) GROUP BY c.testRunId`);
  const result = new Map(ids.map(id => [id, { caseCount: 0, completedCount: 0, activeLeaseCount: 0 }]));
  for (const row of rows) result.set(row.testRunId, { caseCount: Number(row.caseCount), completedCount: Number(row.completedCount), activeLeaseCount: Number(row.activeLeaseCount) });
  return result;
}
