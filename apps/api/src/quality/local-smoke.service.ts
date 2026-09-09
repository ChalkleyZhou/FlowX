import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import {
  FLOWX_PROTOCOL_VERSION,
  type LocalSmokeCompletionReport,
  type LocalSmokeResult,
} from '@flowx-ai/protocol';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { ACTIVE_EXECUTION_SESSION_STATUSES } from '../execution-sessions/execution-session-state';
import { PrismaService } from '../prisma/prisma.service';
import type { ClaimLocalSmokeDto, CreateLocalSmokeRunDto } from './dto/local-smoke.dto';
import { renderSubmissionReport } from './submission-report.render';

const RESULT_PRIORITY: Record<LocalSmokeResult, number> = {
  FAILED: 4,
  BLOCKED: 3,
  SKIPPED: 2,
  PASSED: 1,
};

@Injectable()
export class LocalSmokeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactsService,
  ) {}

  async createRun(testRequestId: string, dto: CreateLocalSmokeRunDto, userId?: string) {
    const request = await this.prisma.testRequest.findUnique({
      where: { id: testRequestId },
      include: {
        workflowLinks: { select: { workflowRunId: true } },
        testPlan: { include: { snapshots: true } },
      },
    });
    if (!request?.testPlan) throw new NotFoundException('Test plan not found.');
    if (!['DRAFT', 'READY'].includes(request.status)) {
      throw new BadRequestException('Local smoke can only start before formal testing.');
    }
    const requestedSnapshotIds = new Set(
      (dto.snapshotIds ?? []).map((value) => value.trim()).filter(Boolean),
    );
    const smokeSnapshots = request.testPlan.snapshots.filter(
      (snapshot) =>
        snapshot.kind === 'SMOKE' &&
        (!requestedSnapshotIds.size || requestedSnapshotIds.has(snapshot.id)),
    );
    if (!smokeSnapshots.length) {
      throw new BadRequestException('At least one smoke snapshot is required.');
    }
    if (requestedSnapshotIds.size && smokeSnapshots.length !== requestedSnapshotIds.size) {
      throw new BadRequestException('Some snapshots are not smoke cases in this test plan.');
    }
    const targets = dedupeTargets(dto.targets);
    if (!targets.length) throw new BadRequestException('At least one target is required.');
    const expectedRevisions = await this.resolveExpectedRevisions(
      request.workflowLinks.map((link) => link.workflowRunId),
    );
    const resolvedTargets = targets.map((target) => ({
      ...target,
      expectedRevisions: this.resolveTargetRevisions(target.expectedRevisions, expectedRevisions),
    }));
    const sourceFingerprint = fingerprint({
      testPlanId: request.testPlan.id,
      scopeRevision: request.scopeRevision,
      snapshots: smokeSnapshots.map((snapshot) => snapshot.id).sort(),
      targets: resolvedTargets.map((target) => ({
        key: target.key,
        expectedRevisions: target.expectedRevisions,
      })),
    });

    const runId = await this.prisma.$transaction(async (tx) => {
      const run = await tx.testRun.create({
        data: {
          testPlanId: request.testPlan!.id,
          name: dto.name.trim(),
          runType: 'LOCAL_SMOKE',
          status: 'ACTIVE',
          sourceFingerprint,
          createdByUserId: userId ?? null,
          startedAt: new Date(),
        },
      });
      for (const target of resolvedTargets) {
        const createdTarget = await tx.testRunTarget.create({
          data: {
            testRunId: run.id,
            key: target.key,
            name: target.name,
            required: target.required,
            expectedRevisions: target.expectedRevisions as unknown as Prisma.InputJsonValue,
          },
        });
        for (const [index, snapshot] of smokeSnapshots.entries()) {
          await tx.testRunCase.create({
            data: {
              testRunId: run.id,
              snapshotId: snapshot.id,
              targetId: createdTarget.id,
              required: true,
              blocking: readMetadataBoolean(snapshot.metadata, 'blocking') ?? true,
              sortOrder: index,
            },
          });
        }
      }
      return run.id;
    });
    return this.getTasks(runId);
  }

  listRuns(testRequestId: string) {
    return this.prisma.testRun.findMany({
      where: { testPlan: { testRequestId }, runType: 'LOCAL_SMOKE' },
      include: {
        targets: true,
        executions: {
          include: { claimedByUser: { select: { id: true, displayName: true } } },
        },
        cases: { include: { snapshot: true, result: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTasks(runId: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        targets: { orderBy: { createdAt: 'asc' } },
        cases: {
          include: { snapshot: true, result: true },
          orderBy: [{ targetId: 'asc' }, { sortOrder: 'asc' }],
        },
        executions: {
          include: { claimedByUser: { select: { id: true, displayName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!run || run.runType !== 'LOCAL_SMOKE') {
      throw new NotFoundException('Local smoke run not found.');
    }
    return run;
  }

  async claim(runId: string, dto: ClaimLocalSmokeDto, userId?: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        testPlan: {
          include: {
            testRequest: { include: { workspace: { select: { organizationId: true } } } },
          },
        },
      },
    });
    if (!run || run.runType !== 'LOCAL_SMOKE') {
      throw new NotFoundException('Local smoke run not found.');
    }
    if (run.status !== 'ACTIVE' || !run.sourceFingerprint) {
      throw new BadRequestException('Local smoke run is not active.');
    }
    const target = await this.prisma.testRunTarget.findFirst({
      where: { id: dto.targetId, testRunId: runId },
      include: { cases: { include: { snapshot: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!target) throw new NotFoundException('Local smoke target not found.');
    const now = new Date();
    const activeExecutions = await this.prisma.testExecution.findMany({
      where: { targetId: target.id, status: 'RUNNING', leaseExpiresAt: { gt: now } },
      select: { claimedCaseIds: true, leaseExpiresAt: true },
    });
    const occupied = new Set(
      activeExecutions.flatMap((execution) => jsonStringArray(execution.claimedCaseIds)),
    );
    const requested = [...new Set((dto.caseIds ?? []).map((value) => value.trim()).filter(Boolean))];
    const targetCaseIds = new Set(target.cases.map((item) => item.id));
    if (requested.some((id) => !targetCaseIds.has(id))) {
      throw new BadRequestException('Some requested cases do not belong to this target.');
    }
    if (requested.some((id) => occupied.has(id))) {
      throw new ConflictException('Some requested cases are covered by an active lease.');
    }
    const claimedCases = requested.length
      ? target.cases.filter((item) => requested.includes(item.id))
      : target.cases.filter((item) => !occupied.has(item.id));
    if (!claimedCases.length) {
      throw new ConflictException('No unclaimed smoke cases are available for this target.');
    }
    const sessionId = randomUUID();
    const executionId = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + (dto.leaseSeconds ?? 1800) * 1000);
    const request = run.testPlan.testRequest;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.executionSession.create({
          data: {
            id: sessionId,
            workflowRunId: null,
            testRunId: runId,
            organizationId: request.workspace.organizationId,
            workspaceId: request.workspaceId,
            projectId: request.projectId,
            deviceId: dto.deviceId?.trim() || null,
            status: 'RUNNING',
            executorType: 'LOCAL',
            sourceTool: 'flowx-local',
            protocolVersion: FLOWX_PROTOCOL_VERSION,
            traceId: randomUUID(),
            claimedByUserId: userId ?? null,
            startedAt: now,
            lastHeartbeatAt: now,
            metadata: {
              purpose: 'LOCAL_SMOKE',
              targetId: target.id,
              sourceFingerprint: run.sourceFingerprint,
            },
          },
        });
        await tx.testExecution.create({
          data: {
            id: executionId,
            testRunId: runId,
            targetId: target.id,
            executionSessionId: sessionId,
            status: 'RUNNING',
            claimedCaseIds: claimedCases.map((item) => item.id),
            claimedByUserId: userId ?? null,
            deviceId: dto.deviceId?.trim() || null,
            sourceFingerprint: run.sourceFingerprint!,
            leaseExpiresAt,
          },
        });
        for (const testRunCase of claimedCases) {
          await tx.testRunCaseLease.deleteMany({
            where: { testRunCaseId: testRunCase.id, leaseExpiresAt: { lte: now } },
          });
          await tx.testRunCaseLease.create({
            data: {
              testRunCaseId: testRunCase.id,
              testExecutionId: executionId,
              leaseExpiresAt,
            },
          });
        }
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Some smoke cases were claimed concurrently. Retry the claim.');
      }
      throw error;
    }
    return {
      testRunId: runId,
      testExecutionId: executionId,
      executionSessionId: sessionId,
      sourceFingerprint: run.sourceFingerprint,
      leaseExpiresAt,
      target,
      cases: claimedCases,
      completionEndpoint: `/execution-sessions/${sessionId}/local-smoke/complete`,
    };
  }

  async complete(
    executionSessionId: string,
    report: LocalSmokeCompletionReport,
    scope: { organizationId?: string | null } = {},
  ) {
    const session = await this.prisma.executionSession.findUnique({
      where: { id: executionSessionId },
      include: {
        testExecution: { include: { target: true } },
        testRun: { include: { testPlan: { include: { testRequest: true } } } },
      },
    });
    if (!session?.testExecution || !session.testRun || session.sourceTool !== 'flowx-local') {
      throw new NotFoundException('Local smoke execution session not found.');
    }
    if (session.testRun.status !== 'ACTIVE') {
      throw new ConflictException('Local smoke run was already finalized.');
    }
    if (session.organizationId && session.organizationId !== scope.organizationId?.trim()) {
      throw new ForbiddenException('Local smoke execution belongs to another organization.');
    }
    const existingKey = readMetadataString(session.metadata, 'completionIdempotencyKey');
    if (session.status === 'COMPLETED') {
      if (existingKey === report.idempotencyKey) return this.getTasks(session.testRun.id);
      throw new ConflictException('Local smoke execution was already completed.');
    }
    if (!ACTIVE_EXECUTION_SESSION_STATUSES.includes(session.status as never)) {
      throw new ConflictException(`Local smoke execution is already ${session.status}.`);
    }
    const execution = session.testExecution;
    if (
      report.sourceFingerprint !== session.testRun.sourceFingerprint ||
      report.sourceFingerprint !== execution.sourceFingerprint
    ) {
      throw new ConflictException({
        code: 'SOURCE_FINGERPRINT_MISMATCH',
        message: 'Smoke source changed after this task was claimed.',
      });
    }
    if (
      JSON.stringify(normalizeRevisions(report.testedRevisions)) !==
      JSON.stringify(normalizeRevisions(asRevisions(execution.target.expectedRevisions)))
    ) {
      await this.markStale(session.id, execution.id, report);
      return { status: 'STALE', reason: 'TESTED_REVISIONS_MISMATCH' };
    }
    const claimedCaseIds = new Set(jsonStringArray(execution.claimedCaseIds));
    const caseResults = dedupeCaseResults(report.caseResults);
    if (!caseResults.length || caseResults.some((item) => !claimedCaseIds.has(item.testRunCaseId))) {
      throw new BadRequestException('Results must only contain cases claimed by this execution.');
    }
    const artifactIds = new Set(report.artifactIds ?? []);
    for (const result of caseResults) {
      for (const artifactId of result.artifactIds ?? []) artifactIds.add(artifactId);
    }
    if (artifactIds.size) {
      const artifacts = await this.prisma.artifact.findMany({
        where: { id: { in: [...artifactIds] }, executionSessionId, status: 'AVAILABLE' },
        select: { id: true },
      });
      if (artifacts.length !== artifactIds.size) {
        throw new BadRequestException('Some smoke artifacts are unavailable or belong to another execution.');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const result of caseResults) {
        await tx.testExecutionCaseResult.create({
          data: {
            testExecutionId: execution.id,
            testRunCaseId: result.testRunCaseId,
            result: result.result,
            durationMs: result.durationMs ?? null,
            actualResult: result.actualResult?.trim() || null,
            remark: result.remark?.trim() || null,
            artifactIds: (result.artifactIds ?? []) as Prisma.InputJsonValue,
          },
        });
      }
      await tx.testExecution.update({
        where: { id: execution.id },
        data: {
          status: 'COMPLETED',
          testedRevisions: normalizeRevisions(report.testedRevisions) as unknown as Prisma.InputJsonValue,
          environment: report.environment as Prisma.InputJsonValue | undefined,
          summary: report.summary?.trim() || null,
          completedAt: new Date(),
        },
      });
      await tx.testRunCaseLease.deleteMany({ where: { testExecutionId: execution.id } });
      const transitioned = await tx.executionSession.updateMany({
        where: { id: session.id, status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          summary: report.summary?.trim() || 'Local smoke execution completed.',
          metadata: {
            ...asJsonObject(session.metadata),
            completionIdempotencyKey: report.idempotencyKey,
            artifactIds: [...artifactIds],
          },
        },
      });
      if (transitioned.count !== 1) {
        throw new ConflictException('Local smoke execution changed during completion.');
      }
      await tx.evidence.create({
        data: {
          executionSessionId: session.id,
          evidenceType: 'TEST_RESULT',
          sourceTool: 'flowx-local',
          title: `Local smoke: ${execution.target.name}`,
          summary: report.summary?.trim() || null,
          status: 'REPORTED',
          occurredAt: new Date(),
          metadata: { artifactIds: [...artifactIds], caseCount: caseResults.length },
        },
      });
    });
    await this.aggregateCases(
      session.testRun.id,
      execution.sourceFingerprint,
      caseResults.map((item) => item.testRunCaseId),
    );
    await this.refreshTargetProgress(execution.targetId);
    return this.getTasks(session.testRun.id);
  }

  async aggregateCases(runId: string, sourceFingerprint: string, caseIds: string[]) {
    for (const testRunCaseId of [...new Set(caseIds)]) {
      const details = await this.prisma.testExecutionCaseResult.findMany({
        where: {
          testRunCaseId,
          testExecution: { testRunId: runId, status: 'COMPLETED', sourceFingerprint },
        },
        include: { testExecution: { select: { claimedByUserId: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (!details.length) continue;
      const selected = [...details].sort(
        (a, b) =>
          RESULT_PRIORITY[b.result as LocalSmokeResult] -
          RESULT_PRIORITY[a.result as LocalSmokeResult],
      )[0];
      await this.prisma.testResult.upsert({
        where: { testRunCaseId },
        update: {
          result: selected.result,
          actualResult: selected.actualResult,
          remark: selected.remark,
          evidence: { artifactIds: jsonStringArray(selected.artifactIds) },
          executedByUserId: selected.testExecution.claimedByUserId,
          executedAt: selected.createdAt,
        },
        create: {
          testRunCaseId,
          result: selected.result,
          actualResult: selected.actualResult,
          remark: selected.remark,
          evidence: { artifactIds: jsonStringArray(selected.artifactIds) },
          executedByUserId: selected.testExecution.claimedByUserId,
          executedAt: selected.createdAt,
        },
      });
    }
  }

  async finalize(runId: string, userId?: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        testPlan: { include: { testRequest: { include: { projectVersion: true } } } },
        targets: true,
        cases: { include: { snapshot: true, result: true } },
        executions: { include: { claimedByUser: { select: { displayName: true } } } },
      },
    });
    if (!run || run.runType !== 'LOCAL_SMOKE') {
      throw new NotFoundException('Local smoke run not found.');
    }
    if (run.status !== 'ACTIVE') {
      throw new BadRequestException('Only active local smoke runs can be finalized.');
    }
    const request = run.testPlan.testRequest;
    if (request.scopeGenerationStatus !== 'COMPLETED') {
      throw new BadRequestException('Test scope must be completed before finalizing local smoke.');
    }
    const activeExecutions = (run.executions ?? []).filter(
      (execution) =>
        execution.status === 'RUNNING' && execution.leaseExpiresAt.getTime() > Date.now(),
    );
    if (activeExecutions.length) {
      throw new ConflictException({
        code: 'LOCAL_SMOKE_EXECUTIONS_ACTIVE',
        message: 'Local smoke executions still hold active leases.',
        testExecutionIds: activeExecutions.map((execution) => execution.id),
      });
    }
    const requiredTargetIds = new Set(
      run.targets.filter((target) => target.required).map((target) => target.id),
    );
    const requiredCases = run.cases.filter(
      (item) => item.required && item.targetId && requiredTargetIds.has(item.targetId),
    );
    const missing = requiredCases.filter((item) => !item.result);
    const blocking = requiredCases.filter(
      (item) => item.blocking && item.result?.result !== 'PASSED',
    );
    if (missing.length || blocking.length) {
      throw new BadRequestException({
        code: 'LOCAL_SMOKE_GATE_FAILED',
        message: 'Required local smoke coverage is incomplete or blocking cases did not pass.',
        missingCaseIds: missing.map((item) => item.id),
        blockingCaseIds: blocking.map((item) => item.id),
      });
    }

    const reportRevision = run.reportRevision + 1;
    const generatedAt = new Date();
    const html = renderSubmissionReport({ run, revision: reportRevision, generatedAt });
    const artifact = await this.artifacts.createServerGeneratedArtifact({
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      artifactType: 'TEST_REPORT',
      name: `submission-report-${run.id}-v${reportRevision}.html`,
      version: String(reportRevision),
      mimeType: 'text/html; charset=utf-8',
      content: Buffer.from(html),
      metadata: {
        testRunId: run.id,
        sourceFingerprint: run.sourceFingerprint,
        generatedAt: generatedAt.toISOString(),
      },
      createdByUserId: userId ?? null,
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        const transitioned = await tx.testRun.updateMany({
          where: { id: run.id, status: 'ACTIVE', reportRevision: run.reportRevision },
          data: { status: 'PASSED', completedAt: generatedAt, reportRevision },
        });
        if (transitioned.count !== 1) {
          throw new ConflictException('Local smoke run changed during report generation.');
        }
        await tx.testRequestArtifact.create({
          data: { testRequestId: request.id, artifactId: artifact.id },
        });
        if (request.status === 'DRAFT') {
          await tx.testRequest.update({ where: { id: request.id }, data: { status: 'READY' } });
        }
      });
    } catch (error) {
      await this.prisma.artifact
        .update({ where: { id: artifact.id }, data: { status: 'DELETED' } })
        .catch(() => undefined);
      throw error;
    }
    return { testRunId: run.id, status: 'PASSED', reportRevision, artifact };
  }

  async latestReport(testRequestId: string) {
    const request = await this.prisma.testRequest.findUnique({
      where: { id: testRequestId },
      include: {
        artifactLinks: {
          where: { artifact: { artifactType: 'TEST_REPORT', status: 'AVAILABLE' } },
          include: { artifact: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!request) throw new NotFoundException('Test request not found.');
    return request.artifactLinks[0]?.artifact ?? null;
  }

  private async markStale(
    executionSessionId: string,
    testExecutionId: string,
    report: LocalSmokeCompletionReport,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.testExecution.update({
        where: { id: testExecutionId },
        data: {
          status: 'STALE',
          testedRevisions: normalizeRevisions(report.testedRevisions) as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      await tx.testRunCaseLease.deleteMany({ where: { testExecutionId } });
      await tx.executionSession.updateMany({
        where: { id: executionSessionId, status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          errorCode: 'TESTED_REVISIONS_MISMATCH',
          summary: report.summary?.trim() || 'Tested revisions do not match the target.',
          metadata: { completionIdempotencyKey: report.idempotencyKey, stale: true },
        },
      });
    });
  }

  private async refreshTargetProgress(targetId: string) {
    const cases = await this.prisma.testRunCase.findMany({
      where: { targetId },
      include: { result: true },
    });
    const completed = cases.filter((item) => item.result);
    const status =
      completed.length !== cases.length
        ? completed.length
          ? 'PARTIAL'
          : 'PENDING'
        : completed.some((item) => item.result?.result === 'FAILED')
          ? 'FAILED'
          : completed.some((item) => ['BLOCKED', 'SKIPPED'].includes(item.result?.result ?? ''))
            ? 'BLOCKED'
            : 'PASSED';
    await this.prisma.testRunTarget.update({ where: { id: targetId }, data: { status } });
  }

  private async resolveExpectedRevisions(workflowRunIds: string[]) {
    if (!workflowRunIds.length) return [];
    const evidence = await this.prisma.evidence.findMany({
      where: {
        evidenceType: 'GIT_COMMIT',
        status: 'REPORTED',
        executionSession: {
          workflowRunId: { in: workflowRunIds },
          status: 'COMPLETED',
        },
      },
      select: { metadata: true },
      orderBy: { occurredAt: 'desc' },
    });
    const revisions = new Map<string, TestedRevision>();
    for (const item of evidence) {
      const revision = readTestedRevision(item.metadata);
      if (revision && !revisions.has(revision.workflowRepositoryId)) {
        revisions.set(revision.workflowRepositoryId, revision);
      }
    }
    return normalizeRevisions([...revisions.values()]);
  }

  private resolveTargetRevisions(requested: TestedRevision[] | undefined, current: TestedRevision[]) {
    const normalized = normalizeRevisions(requested);
    if (!normalized.length) {
      if (!current.length) {
        throw new BadRequestException({
          code: 'LOCAL_SMOKE_REVISION_REQUIRED',
          message: 'No completed development revision is available for local smoke.',
        });
      }
      return current;
    }
    const currentByRepository = new Map(
      current.map((revision) => [revision.workflowRepositoryId, revision]),
    );
    const stale = normalized.filter((revision) => {
      const recorded = currentByRepository.get(revision.workflowRepositoryId);
      return !recorded || recorded.branch !== revision.branch || recorded.headSha !== revision.headSha;
    });
    if (stale.length) {
      throw new ConflictException({
        code: 'LOCAL_SMOKE_REVISION_STALE',
        message: 'Requested smoke revisions do not match completed development evidence.',
        workflowRepositoryIds: stale.map((revision) => revision.workflowRepositoryId),
      });
    }
    return normalized;
  }
}

type TestedRevision = {
  workflowRepositoryId: string;
  branch: string;
  headSha: string;
};

function dedupeTargets(targets: CreateLocalSmokeRunDto['targets']) {
  const byKey = new Map<
    string,
    {
      key: string;
      name: string;
      required: boolean;
      expectedRevisions: CreateLocalSmokeRunDto['targets'][number]['expectedRevisions'];
    }
  >();
  for (const target of targets) {
    const key = target.key.trim().toLowerCase();
    if (!key) continue;
    byKey.set(key, {
      key,
      name: target.name.trim(),
      required: target.required !== false,
      expectedRevisions: target.expectedRevisions,
    });
  }
  return [...byKey.values()];
}

function normalizeRevisions(revisions: TestedRevision[] | undefined) {
  return (revisions ?? [])
    .map((item) => ({
      workflowRepositoryId: item.workflowRepositoryId.trim(),
      branch: item.branch.trim(),
      headSha: item.headSha.trim().toLowerCase(),
    }))
    .sort((a, b) => a.workflowRepositoryId.localeCompare(b.workflowRepositoryId));
}

function readTestedRevision(value: unknown): TestedRevision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  if (
    typeof metadata.workflowRepositoryId !== 'string' ||
    typeof metadata.workingBranch !== 'string' ||
    typeof metadata.headSha !== 'string'
  ) {
    return null;
  }
  return {
    workflowRepositoryId: metadata.workflowRepositoryId,
    branch: metadata.workingBranch,
    headSha: metadata.headSha,
  };
}

function asRevisions(
  value: unknown,
): Array<{ workflowRepositoryId: string; branch: string; headSha: string }> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is { workflowRepositoryId: string; branch: string; headSha: string } =>
          Boolean(
            item &&
              typeof item === 'object' &&
              typeof (item as Record<string, unknown>).workflowRepositoryId === 'string' &&
              typeof (item as Record<string, unknown>).branch === 'string' &&
              typeof (item as Record<string, unknown>).headSha === 'string',
          ),
      )
    : [];
}

function dedupeCaseResults(results: LocalSmokeCompletionReport['caseResults']) {
  const byCase = new Map<string, LocalSmokeCompletionReport['caseResults'][number]>();
  for (const result of results) byCase.set(result.testRunCaseId, result);
  return [...byCase.values()];
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asJsonObject(value: unknown): Prisma.InputJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Prisma.InputJsonObject)
    : {};
}

function readMetadataString(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? field.trim() : null;
}

function readMetadataBoolean(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'boolean' ? field : null;
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isUniqueConstraintError(value: unknown) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'code' in value &&
      (value as { code?: unknown }).code === 'P2002',
  );
}
