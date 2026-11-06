import { runBrowseInclude, runSummaries } from './test-run-browse';
import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { QualityExecutionReport, QualityExecutionControl } from '@flowx-ai/protocol';
import { PrismaService } from '../prisma/prisma.service';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { assertLocalSessionOwner, type LocalSessionScope } from '../workflow/workflow-local-ownership';
import { LocalSmokeService } from './local-smoke.service';
import type { CreateLocalTestRunDto, FinishQualityRunDto, QualityControlDto } from './dto/local-test-run.dto';
import { qualityHash, qualityRecord, qualityRevisions } from './local-test-execution';
import { stringArray } from './test-case-selection';
import { summarizeQualityResults } from './test-report-summary';
import { refreshTestRequestStatus } from './test-request-state';
import { assertTestRequestTransition, TestRequestStatus } from './quality-status';

@Injectable()
export class LocalTestRunsService extends LocalSmokeService {
  constructor(prisma: PrismaService, artifacts: ArtifactsService) { super(prisma, artifacts); }
  protected supportsLocalRun(run: { runType: string; executionMode?: string }) {
    return run.executionMode === 'LOCAL' && ['INITIAL', 'REGRESSION'].includes(run.runType);
  }

  async listTasks(filters: PaginationQuery & { projectId?: string; projectVersionId?: string; testRequestId?: string; q?: string }) {
    const paging = parsePagination(filters);
    const where: Prisma.TestRunWhereInput = { executionMode: 'LOCAL', status: 'ACTIVE',
      testPlan: { testRequest: { projectId: filters.projectId, projectVersionId: filters.projectVersionId, id: filters.testRequestId } },
      ...(filters.q?.trim() ? { name: { contains: filters.q.trim() } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.testRun.findMany({ where, include: runBrowseInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: paging.skip, take: paging.take }),
      this.prisma.testRun.count({ where }),
    ]);
    const summaries = await runSummaries(this.prisma, items.map(run => run.id));
    return pageResult(items.map(run => ({ ...run, testRequest: run.testPlan.testRequest, summary: summaries.get(run.id)! })), total, paging);
  }

  async getRun(id: string) {
    const run = await this.prisma.testRun.findUnique({ where: { id }, include: {
      testPlan: { include: { testRequest: { include: { project: true, projectVersion: true, requirementLinks: { include: { requirement: { select: { id: true, title: true } } } } } } } },
      sourceBug: { include: { fixWorkflowRun: { select: { id: true, status: true } } } },
      targets: true, cases: { include: { snapshot: true, target: true, result: { include: { bug: { include: { fixWorkflowRun: { select: { id: true, status: true } } } } } }, activeLease: true }, orderBy: { sortOrder: 'asc' } },
      executions: { include: { results: true, claimedByUser: { select: { id: true, displayName: true } } } },
    } });
    if (!run) throw new NotFoundException('测试轮次不存在。');
    return run;
  }

  async createTestRun(id: string, dto: CreateLocalTestRunDto, userId?: string) {
    const request = await this.prisma.testRequest.findUnique({ where: { id }, include: { testPlan: { include: { snapshots: true } }, workflowLinks: { include: { workflowRun: { select: { status: true } } } } } });
    if (!request?.testPlan) throw new NotFoundException('测试计划不存在。');
    if (request.testPlan.status !== 'READY' || request.scopeGenerationStatus !== 'COMPLETED' || !['READY', 'IN_TEST', 'PASSED', 'FAILED', 'BLOCKED'].includes(request.status)) throw new BadRequestException('请先完成测试范围和提测准备。');
    if (!request.workflowLinks.length || request.workflowLinks.some(link => link.workflowRun.status.toLowerCase() !== 'done')) throw new BadRequestException('关联研发工作流尚未完成。');
    let fixWorkflowRunId: string | undefined;
    if (dto.runType === 'REGRESSION') {
      const bug = dto.sourceBugId ? await this.prisma.bug.findFirst({ where: { id: dto.sourceBugId, projectId: request.projectId }, include: { fixWorkflowRun: { include: { requirement: { select: { projectId: true } } } } } }) : null;
      if (!bug?.fixWorkflowRun || bug.fixWorkflowRun.requirement.projectId !== request.projectId || bug.fixWorkflowRun.status.toLowerCase() !== 'done') throw new BadRequestException('回归必须关联当前项目且修复已完成的缺陷。');
      fixWorkflowRunId = bug.fixWorkflowRun.id;
    } else if (dto.sourceBugId) throw new BadRequestException('初测不能关联来源缺陷。');
    const targets = dto.targets.map(item => ({ ...item, key: item.key.trim().toLowerCase() }));
    if (!targets.length || new Set(targets.map(item => item.key)).size !== targets.length) throw new BadRequestException('目标端不能为空或重复。');
    const snapshots = request.testPlan.snapshots;
    if (!dto.cases.length || new Set(dto.cases.map(item => item.snapshotId)).size !== dto.cases.length) throw new BadRequestException('用例映射不能为空或重复。');
    for (const item of dto.cases) {
      if (!snapshots.some(snapshot => snapshot.id === item.snapshotId) || !item.targetKeys.length || new Set(item.targetKeys).size !== item.targetKeys.length || item.targetKeys.some(key => !targets.some(target => target.key === key))) throw new BadRequestException('用例或适用端映射不属于当前计划。');
    }
    if (targets.some(target => !dto.cases.some(item => item.targetKeys.includes(target.key)))) throw new BadRequestException('每个目标端必须有适用用例。');
    const revisions = await this.resolveQualityRevisions(request.workflowLinks.map(link => link.workflowRunId), fixWorkflowRunId);
    const resolved = targets.map(target => ({ ...target, expectedRevisions: this.resolveTargetRevisions(target.expectedRevisions, revisions) }));
    const sourceFingerprint = qualityHash({ planId: request.testPlan.id, scopeRevision: request.scopeRevision, cases: dto.cases, targets: resolved });
    const run = await this.prisma.$transaction(async tx => {
      const current = await tx.testRequest.findUniqueOrThrow({ where: { id } });
      if (current.scopeRevision !== request.scopeRevision || !['READY', 'IN_TEST', 'PASSED', 'FAILED', 'BLOCKED'].includes(current.status)) throw new ConflictException('测试范围或状态已变化。');
      if (current.status !== 'IN_TEST') assertTestRequestTransition(current.status as TestRequestStatus, TestRequestStatus.IN_TEST);
      const created = await tx.testRun.create({ data: { testPlanId: request.testPlan!.id, name: dto.name.trim(), runType: dto.runType, sourceBugId: dto.sourceBugId, executionMode: 'LOCAL', sourceFingerprint, createdByUserId: userId, startedAt: new Date() } });
      for (const target of resolved) {
        const saved = await tx.testRunTarget.create({ data: { testRunId: created.id, key: target.key, name: target.name, required: target.required !== false, expectedRevisions: target.expectedRevisions as unknown as Prisma.InputJsonValue } });
        for (const [sortOrder, item] of dto.cases.filter(item => item.targetKeys.includes(target.key)).entries()) await tx.testRunCase.create({ data: { testRunId: created.id, targetId: saved.id, snapshotId: item.snapshotId, sortOrder } });
      }
      await tx.testRequest.update({ where: { id }, data: { status: 'IN_TEST' } });
      return created;
    });
    return this.getRun(run.id);
  }

  protected async resolveQualityRevisions(workflowIds: string[], fixWorkflowId?: string) {
    const original = await this.resolveExpectedRevisions(workflowIds);
    if (!fixWorkflowId) return original;
    const fixed = await this.resolveExpectedRevisions([fixWorkflowId]);
    if (!fixed.length) throw new BadRequestException('修复工作流尚无已完成的代码交付，不能使用原开发版本回归。');
    const repositories = await this.prisma.workflowRepository.findMany({ where: { id: { in: [...original, ...fixed].map(item => item.workflowRepositoryId) } }, select: { id: true, repositoryId: true } });
    const identity = new Map(repositories.map(item => [item.id, item.repositoryId ?? item.id]));
    const byRepository = new Map<string, typeof original[number]>();
    for (const item of original) {
      const key = identity.get(item.workflowRepositoryId) ?? item.workflowRepositoryId;
      const prior = byRepository.get(key);
      if (prior && (prior.headSha !== item.headSha || prior.branch !== item.branch)) throw new BadRequestException('原开发范围包含同仓库的冲突版本，请先明确基线。');
      byRepository.set(key, item);
    }
    for (const item of fixed) byRepository.set(identity.get(item.workflowRepositoryId) ?? item.workflowRepositoryId, item);
    return [...byRepository.values()].sort((a, b) => a.workflowRepositoryId.localeCompare(b.workflowRepositoryId));
  }

  progress(id: string, report: QualityExecutionReport, scope: LocalSessionScope) { return this.saveResults(id, report, scope, false); }
  completeTest(id: string, report: QualityExecutionReport, scope: LocalSessionScope) { return this.saveResults(id, report, scope, true); }

  private async saveResults(id: string, report: QualityExecutionReport, scope: LocalSessionScope, complete: boolean) {
    const payloadHash = qualityHash({ action: complete ? 'complete' : 'progress', report });
    return this.prisma.$transaction(async tx => {
      const session = await tx.executionSession.findUnique({ where: { id }, include: { testExecution: { include: { target: true, results: true } }, testRun: true } });
      if (!session?.testExecution || !session.testRun || !this.supportsLocalRun(session.testRun) || session.sourceTool !== 'flowx-local' || qualityRecord(session.metadata).purpose !== 'QUALITY_TEST') throw new NotFoundException('本地测试会话不存在。');
      assertLocalSessionOwner(session, scope);
      if (session.organizationId !== scope.organizationId) throw new ForbiddenException('测试会话不属于当前组织。');
      const execution = session.testExecution;
      const existing = await tx.qualityProgressEvent.findUnique({ where: { executionSessionId_idempotencyKey: { executionSessionId: id, idempotencyKey: report.idempotencyKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException('同一幂等键的内容不一致。');
        return existing.response;
      }
      const now = new Date();
      if (session.status !== 'RUNNING' || execution.status !== 'RUNNING' || execution.leaseExpiresAt <= now || session.testRun.status !== 'ACTIVE') throw new ConflictException('会话已结束或租约已过期，请重新领取。');
      if (report.sourceFingerprint !== execution.sourceFingerprint || report.sourceFingerprint !== session.testRun.sourceFingerprint || report.testRunRevision !== qualityRecord(session.metadata).testRunRevision) throw new ConflictException('任务版本已变化，请重新领取。');
      if (!qualityRevisions(report.testedRevisions).length || qualityHash(qualityRevisions(report.testedRevisions)) !== qualityHash(qualityRevisions(execution.target.expectedRevisions))) throw new ConflictException('实际测试代码版本不匹配，结果未纳入统计。');
      const claimed = stringArray(execution.claimedCaseIds);
      if (new Set(report.caseResults.map(item => item.testRunCaseId)).size !== report.caseResults.length || report.caseResults.some(item => !claimed.includes(item.testRunCaseId))) throw new BadRequestException('结果只能包含本会话领取的用例且不能重复。');
      const leases = await tx.testRunCaseLease.findMany({ where: { testExecutionId: execution.id, leaseExpiresAt: { gt: now } } });
      if (leases.length !== claimed.length) throw new ConflictException('部分用例租约已变化。');
      const artifactIds = [...new Set([...(report.artifactIds ?? []), ...report.caseResults.flatMap(item => item.artifactIds ?? [])])];
      if (artifactIds.length && await tx.artifact.count({ where: { id: { in: artifactIds }, executionSessionId: id, status: 'AVAILABLE' } }) !== artifactIds.length) throw new BadRequestException('证据未上传完成或不属于当前执行会话。');
      const normalized = (item: { result: string; actualResult?: string | null; remark?: string | null; artifactIds?: unknown; durationMs?: number | null }) => ({ result: item.result, actualResult: item.actualResult?.trim() || null, remark: item.remark?.trim() || null, artifactIds: stringArray(item.artifactIds).sort(), durationMs: item.durationMs ?? null });
      for (const result of report.caseResults) {
        const saved = execution.results.find(item => item.testRunCaseId === result.testRunCaseId);
        if (saved && qualityHash(normalized(saved)) !== qualityHash(normalized(result))) throw new ConflictException('已保存结果不可覆盖，请创建新轮次。');
      }
      const reported = new Set([...execution.results.map(item => item.testRunCaseId), ...report.caseResults.map(item => item.testRunCaseId)]);
      if (complete && claimed.some(caseId => !reported.has(caseId))) throw new BadRequestException('仍有已领取用例未回传结果。');
      const locked = await tx.testRun.updateMany({ where: { id: session.testRun.id, status: 'ACTIVE', revision: session.testRun.revision }, data: { revision: { increment: 1 } } });
      if (locked.count !== 1) throw new ConflictException('轮次已变化，请重试。');
      for (const result of report.caseResults) {
        if (execution.results.some(item => item.testRunCaseId === result.testRunCaseId)) continue;
        await tx.testExecutionCaseResult.create({ data: { testExecutionId: execution.id, testRunCaseId: result.testRunCaseId, ...normalized(result) } });
        const prior = await tx.testResult.findUnique({ where: { testRunCaseId: result.testRunCaseId } });
        // 同一轮次出现冲突时保留较严重结论，回归必须另开轮次。
        const weight = { PASSED: 0, SKIPPED: 1, BLOCKED: 2, FAILED: 3 };
        if (!prior || weight[result.result] > (weight[prior.result as keyof typeof weight] ?? -1)) {
          const data = { result: result.result, actualResult: result.actualResult?.trim() || null, remark: result.remark?.trim() || null, evidence: { artifactIds: result.artifactIds ?? [] }, executedByUserId: scope.userId, executedAt: now };
          await tx.testResult.upsert({ where: { testRunCaseId: result.testRunCaseId }, create: { testRunCaseId: result.testRunCaseId, ...data }, update: data });
        }
      }
      await tx.testExecution.update({ where: { id: execution.id }, data: { ...(complete ? { status: 'COMPLETED', completedAt: now } : {}), summary: report.summary, environment: report.environment as Prisma.InputJsonValue | undefined, testedRevisions: qualityRevisions(report.testedRevisions) as unknown as Prisma.InputJsonValue } });
      await tx.executionSession.update({ where: { id }, data: { ...(complete ? { status: 'COMPLETED', completedAt: now } : {}), lastHeartbeatAt: now, summary: report.summary } });
      if (complete) await tx.testRunCaseLease.deleteMany({ where: { testExecutionId: execution.id } });
      const cases = await tx.testRunCase.findMany({ where: { targetId: execution.targetId }, include: { result: true } });
      const summary = summarizeQualityResults(cases.map(item => item.result?.result));
      await tx.testRunTarget.update({ where: { id: execution.targetId }, data: { status: summary.pending ? 'ACTIVE' : summary.conclusion } });
      const response = { executionSessionId: id, status: complete ? 'COMPLETED' : 'RUNNING', acceptedCaseIds: report.caseResults.map(item => item.testRunCaseId) };
      await tx.qualityProgressEvent.create({ data: { testExecutionId: execution.id, executionSessionId: id, idempotencyKey: report.idempotencyKey, action: complete ? 'complete' : 'progress', payloadHash, response } });
      return response;
    });
  }

  async control(id: string, action: QualityExecutionControl, dto: QualityControlDto, scope: LocalSessionScope) {
    return this.prisma.$transaction(async tx => {
      const session = await tx.executionSession.findUnique({ where: { id }, include: { testExecution: true, testRun: true } });
      if (!session?.testExecution || !session.testRun || !this.supportsLocalRun(session.testRun) || session.sourceTool !== 'flowx-local' || qualityRecord(session.metadata).purpose !== 'QUALITY_TEST') throw new NotFoundException('本地测试会话不存在。');
      assertLocalSessionOwner(session, scope);
      if (session.organizationId !== scope.organizationId) throw new ForbiddenException('测试会话不属于当前组织。');
      if (session.status !== 'RUNNING' || session.testExecution.status !== 'RUNNING' || session.testExecution.leaseExpiresAt <= new Date() || session.testRun.status !== 'ACTIVE') throw new ConflictException('会话已结束或租约已过期。');
      const seconds = dto.leaseSeconds ?? 1800;
      if (seconds < 60 || seconds > 86400) throw new BadRequestException('租约必须在 60 到 86400 秒之间。');
      if (action !== 'heartbeat' && !dto.reason?.trim()) throw new BadRequestException('请填写结束或释放原因。');
      await tx.testRun.update({ where: { id: session.testRun.id }, data: { revision: { increment: 1 } } });
      if (action === 'heartbeat') {
        const leaseExpiresAt = new Date(Date.now() + seconds * 1000);
        await tx.testExecution.update({ where: { id: session.testExecution.id }, data: { leaseExpiresAt } });
        await tx.testRunCaseLease.updateMany({ where: { testExecutionId: session.testExecution.id }, data: { leaseExpiresAt } });
        await tx.executionSession.update({ where: { id }, data: { lastHeartbeatAt: new Date() } });
        return { status: 'RUNNING', leaseExpiresAt };
      }
      await tx.testRunCaseLease.deleteMany({ where: { testExecutionId: session.testExecution.id } });
      await tx.testExecution.update({ where: { id: session.testExecution.id }, data: { status: 'CANCELLED', summary: dto.reason, completedAt: new Date() } });
      await tx.executionSession.update({ where: { id }, data: { status: 'CANCELLED', summary: dto.reason, completedAt: new Date() } });
      return { status: 'CANCELLED', deviceStopped: false };
    });
  }

  async linkBug(runId: string, caseId: string, bugId: string) {
    return this.prisma.$transaction(async tx => {
      const item = await tx.testRunCase.findFirst({ where: { id: caseId, testRunId: runId }, include: { result: true, testRun: { include: { testPlan: { include: { testRequest: true } } } } } });
      if (!item?.result) throw new NotFoundException('已执行测试项不存在。');
      if (!['FAILED', 'BLOCKED'].includes(item.result.result)) throw new BadRequestException('只有失败或阻塞结果可以关联缺陷。');
      const bug = await tx.bug.findFirst({ where: { id: bugId, projectId: item.testRun.testPlan.testRequest.projectId } });
      if (!bug) throw new BadRequestException('缺陷不属于当前提测项目。');
      if (item.result.bugId && item.result.bugId !== bugId) throw new ConflictException('该结果已关联其他缺陷，请保留原关联。');
      await tx.testRun.update({ where: { id: runId }, data: { revision: { increment: 1 } } });
      return tx.testResult.update({ where: { id: item.result.id }, data: { bugId } });
    });
  }

  async finish(id: string, dto: FinishQualityRunDto, _userId?: string) {
    await this.prisma.$transaction(async tx => {
      const run = await tx.testRun.findUnique({ where: { id }, include: { cases: { include: { result: true } }, testPlan: true } });
      if (!run || run.executionMode !== 'LOCAL') throw new NotFoundException('本地测试轮次不存在。');
      if (await tx.testExecution.count({ where: { testRunId: id, status: 'RUNNING', leaseExpiresAt: { gt: new Date() } } })) throw new ConflictException('仍有有效执行租约，请等待完成或先取消。');
      const status = summarizeQualityResults(run.cases.map(item => item.result?.result)).conclusion;
      const changed = await tx.testRun.updateMany({ where: { id, status: 'ACTIVE', revision: dto.revision }, data: { status, completedAt: new Date(), revision: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException('轮次已变化，请刷新后重试。');
      await refreshTestRequestStatus(tx, run.testPlan.testRequestId);
    });
    return this.getRun(id);
  }
}
