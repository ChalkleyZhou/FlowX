import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ArtifactsService } from '../artifacts/artifacts.service';
import type { CreateRequestTestReportDto, CreateRunTestReportDto } from './dto/test-report.dto';
import { missingQualityScopes, summarizeTestRequestScope } from './test-request-summary';
import { refreshTestRequestStatus, runScopeFingerprint } from './test-request-state';
import { qualityHash, qualityRecord, qualityRevisions } from './local-test-execution';
import { stringArray } from './test-case-selection';
import { summarizeQualityResults } from './test-report-summary';
import { renderQualityTestReport, type QualityReportSnapshot } from './test-report.render';

const reportRunInclude = {
  testPlan: { include: { snapshots: true, testRequest: { include: { project: true, projectVersion: true, testDesign: { select: { coverageChecks: true, uncoveredItems: true } }, requirementLinks: { include: { requirement: { select: { id: true, title: true } } } } } } } },
  targets: true, sourceBug: { include: { fixWorkflowRun: { select: { status: true } } } },
  cases: { include: { snapshot: true, result: true, target: true } },
  executions: { include: { results: true, claimedByUser: { select: { displayName: true } } } },
} as const;
type ReportRun = Prisma.TestRunGetPayload<{ include: typeof reportRunInclude }>;

@Injectable()
export class TestReportsService {
  constructor(private readonly prisma: PrismaService, private readonly artifacts: ArtifactsService) {}
  async list(requestId: string, query: PaginationQuery = {}) {
    const request = await this.prisma.testRequest.findUnique({ where: { id: requestId }, select: { id: true } });
    if (!request) throw new NotFoundException('提测不存在。');
    const paging = parsePagination(query);
    const [items, total] = await Promise.all([
      this.prisma.qualityTestReport.findMany({ where: { requestId }, select: { id: true, requestId: true, runId: true, kind: true, revision: true, artifactId: true, artifact: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: paging.skip, take: paging.take }),
      this.prisma.qualityTestReport.count({ where: { requestId } }),
    ]);
    const metadata = items.length ? await this.prisma.$queryRaw<Array<{ id: string; mode: string | null; summary: string | null; supersessionCount: number | bigint | null }>>(Prisma.sql`
      SELECT id, json_extract(snapshot, '$.mode') AS mode,
        json_extract(snapshot, '$.summary') AS summary,
        COALESCE(json_array_length(snapshot, '$.supersessions'), 0) AS supersessionCount
      FROM QualityTestReport WHERE id IN (${Prisma.join(items.map(item => item.id))})
    `) : [];
    const byId = new Map(metadata.map(item => [item.id, item]));
    return pageResult(items.map(item => {
      const detail = byId.get(item.id);
      return { ...item, mode: detail?.mode ?? null, summary: detail?.summary ? JSON.parse(detail.summary) as Record<string, unknown> : null, supersessionCount: Number(detail?.supersessionCount ?? 0) };
    }), total, paging);
  }
  async createRunReport(runId: string, dto: CreateRunTestReportDto, userId?: string) {
    const run = await this.prisma.testRun.findUnique({ where: { id: runId }, include: reportRunInclude });
    if (!run) throw new NotFoundException('测试轮次不存在。');
    return this.persist([run], dto, 'RUN', { runId }, run.cases.map(item => item.result?.result), userId);
  }
  async createRequestReport(requestId: string, dto: CreateRequestTestReportDto, userId?: string) {
    const ids = [...new Set(dto.runIds)];
    const runs = await this.prisma.testRun.findMany({ where: { id: { in: ids }, testPlan: { testRequestId: requestId }, runType: { not: 'LOCAL_SMOKE' } }, include: reportRunInclude });
    if (runs.length !== ids.length || !runs.length) throw new BadRequestException('汇总轮次不属于当前提测或包含冒烟门禁轮次。');
    const prior = await this.prisma.qualityTestReport.findUnique({ where: { requestId_idempotencyKey: { requestId, idempotencyKey: dto.idempotencyKey } }, include: { artifact: true } });
    if (prior) {
      if (prior.payloadHash !== qualityHash({ kind: 'REQUEST', dto, runIds: runs.map(run => run.id).sort() })) throw new ConflictException('报告幂等键已用于不同参数。');
      return prior;
    }
    const baseline = qualityRevisions(dto.baseline);
    if (!baseline.length || baseline.length !== dto.baseline.length) throw new BadRequestException('必须选择明确的汇总代码基线。');
    const repositoryIds = [...new Set([...baseline, ...runs.flatMap(run => run.targets.flatMap(target => qualityRevisions(target.expectedRevisions)))].map(item => item.workflowRepositoryId))];
    const repositories = await this.prisma.workflowRepository.findMany({ where: { id: { in: repositoryIds } }, select: { id: true, repositoryId: true } });
    const repositoryIdentity = new Map(repositories.map(item => [item.id, item.repositoryId ?? item.id]));
    const snapshots = runs[0].testPlan.snapshots.filter(item => item.kind === 'FUNCTIONAL');
    const requiredScopes = snapshots.map(item => ({ snapshotId: item.id, targetKeys: stringArray(item.targetKeys) }));
    const effective = summarizeTestRequestScope({ runs, baseline, supersessions: dto.supersessions, repositoryIdentity, requiredScopes });
    const effectiveIds = new Set(effective.effectiveCaseIds);
    const untestedScopes = missingQualityScopes(requiredScopes, runs.flatMap(run => run.cases.filter(item => effectiveIds.has(item.id)).map(item => ({ snapshotId: item.snapshotId, targetKey: item.target?.key ?? null })))).map(item => ({ ...item, title: snapshots.find(snapshot => snapshot.id === item.snapshotId)!.title }));
    return this.persist(runs, dto, 'REQUEST', { baseline, supersessions: dto.supersessions ?? [], effectiveCaseIds: effective.effectiveCaseIds, untestedScopes }, effective.results, userId);
  }

  private async persist(runs: ReportRun[], dto: CreateRunTestReportDto, kind: 'RUN' | 'REQUEST', extra: Record<string, unknown>, results: Array<string | null | undefined>, userId?: string) {
    const request = runs[0].testPlan.testRequest;
    const payloadHash = qualityHash({ kind, dto, runIds: runs.map(run => run.id).sort() });
    const prior = await this.prisma.qualityTestReport.findUnique({ where: { requestId_idempotencyKey: { requestId: request.id, idempotencyKey: dto.idempotencyKey } }, include: { artifact: true } });
    if (prior) {
      if (prior.payloadHash !== payloadHash) throw new ConflictException('报告幂等键已用于不同参数。');
      return prior;
    }
    if (dto.mode === 'FINAL' && runs.some(run => run.status === 'ACTIVE' || run.executions.some(item => item.status === 'RUNNING' && item.leaseExpiresAt > new Date()))) throw new ConflictException('最终报告要求先结束轮次，且不能存在有效执行租约。');
    const safeEnvironment = (value: unknown) => Object.fromEntries(Object.entries(qualityRecord(value)).filter(([key, val]) => ['os', 'browser', 'runtime', 'device', 'baseUrl', 'name'].includes(key) && typeof val === 'string').map(([key, val]) => {
      if (key === 'baseUrl') { try { const url = new URL(String(val)); return [key, `${url.protocol}//${url.host}${url.pathname}`]; } catch { return [key, '未记录']; } }
      return [key, val];
    }));
    const snapshot: QualityReportSnapshot = {
      mode: dto.mode, generatedAt: new Date().toISOString(),
      request: { id: request.id, title: request.title, project: request.project.name, version: request.projectVersion.name, requirements: request.requirementLinks.map(link => link.requirement), coverageChecks: request.testDesign?.coverageChecks, uncoveredItems: request.testDesign?.uncoveredItems },
      summary: summarizeQualityResults(results), ...extra,
      scopeRunFacts: Object.fromEntries(runs.map(run => [run.id, runScopeFingerprint(run)])),
      runs: runs.map(run => ({ id: run.id, name: run.name, runType: run.runType, status: run.status,
        targets: run.targets.map(target => ({ key: target.key, name: target.name, expectedRevisions: target.expectedRevisions })),
        executions: run.executions.map(item => ({ id: item.id, user: item.claimedByUser?.displayName, deviceId: item.deviceId, status: item.status, environment: safeEnvironment(item.environment), testedRevisions: item.testedRevisions, startedAt: item.startedAt, completedAt: item.completedAt, caseResults: item.results })),
        cases: run.cases.map(item => ({ id: item.id, title: item.snapshot.title, selectionReason: item.snapshot.selectionReason, coverageKeys: qualityRecord(item.snapshot.metadata).coverageKeys, target: item.target?.name ?? '-', priority: item.snapshot.priority, expected: item.snapshot.expected, result: item.result?.result ?? null, actualResult: item.result?.actualResult ?? null, remark: item.result?.remark ?? null, artifactIds: stringArray(qualityRecord(item.result?.evidence).artifactIds), bugId: item.result?.bugId ?? null })),
      })),
    };
    const last = await this.prisma.qualityTestReport.findFirst({ where: { requestId: request.id, kind }, orderBy: { revision: 'desc' } });
    const revision = (last?.revision ?? 0) + 1;
    const sourceFingerprint = qualityHash(snapshot);
    const artifact = await this.artifacts.createServerGeneratedArtifact({ workspaceId: request.workspaceId, projectId: request.projectId, artifactType: 'TEST_REPORT', name: `test-report-${request.id}-${kind.toLowerCase()}-v${revision}.html`, version: String(revision), mimeType: 'text/html; charset=utf-8', content: Buffer.from(renderQualityTestReport(snapshot)), metadata: { requestId: request.id, kind, revision, sourceFingerprint }, createdByUserId: userId });
    try {
      return await this.prisma.$transaction(async tx => {
        for (const run of runs) {
          const locked = await tx.testRun.updateMany({ where: { id: run.id, revision: run.revision }, data: { revision: { increment: 1 } } });
          if (locked.count !== 1) throw new ConflictException('生成期间执行结果已变化，请重试。');
        }
        const created = await tx.qualityTestReport.create({ data: { requestId: request.id, runId: kind === 'RUN' ? runs[0].id : null, kind, revision, idempotencyKey: dto.idempotencyKey, payloadHash, sourceFingerprint, artifactId: artifact.id, snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue, createdByUserId: userId }, include: { artifact: true } });
        await tx.testRequestArtifact.create({ data: { testRequestId: request.id, artifactId: artifact.id } });
        if (kind === 'REQUEST') await refreshTestRequestStatus(tx, request.id);
        return created;
      });
    } catch (error) {
      await this.prisma.artifact.update({ where: { id: artifact.id }, data: { status: 'DELETED' } });
      const winner = await this.prisma.qualityTestReport.findUnique({ where: { requestId_idempotencyKey: { requestId: request.id, idempotencyKey: dto.idempotencyKey } }, include: { artifact: true } });
      if (winner?.payloadHash === payloadHash) return winner;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('报告版本并发变化，请重试。');
      throw error;
    }
  }
}
