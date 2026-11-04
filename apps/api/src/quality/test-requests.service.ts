import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AddTestScopeCasesDto, CompleteTestScopeDto, CreateTestRequestDto, PrepareTestRequestDto } from './dto/test-request.dto';
import { TestRequestStatus, assertTestRequestTransition } from './quality-status';
import { TestDesignsService } from './test-designs.service';

const requestInclude = {
  project: true,
  projectVersion: true,
  requirementLinks: { include: { requirement: true } },
  workflowLinks: { include: { workflowRun: true } },
  artifactLinks: { include: { artifact: true } },
  testPlan: {
    include: {
      snapshots: { orderBy: { createdAt: 'asc' as const } },
      runs: { orderBy: { createdAt: 'desc' as const } },
    },
  },
} as const;

@Injectable()
export class TestRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly testDesigns: TestDesignsService,
  ) {}

  async createRequest(dto: CreateTestRequestDto, userId?: string) {
    const requirementIds = unique(dto.requirementIds);
    const workflowRunIds = unique(dto.workflowRunIds);
    const artifactIds = unique(dto.artifactIds ?? []);

    if (!requirementIds.length) {
      throw new BadRequestException('At least one requirement is required.');
    }
    if (!workflowRunIds.length) {
      throw new BadRequestException('At least one completed workflow run is required.');
    }

    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, workspaceId: dto.workspaceId, status: 'ACTIVE' },
    });
    if (!project) {
      throw new BadRequestException('Project does not belong to the selected workspace.');
    }
    const projectVersion = await this.prisma.projectVersion.findFirst({
      where: { id: dto.projectVersionId, projectId: dto.projectId },
    });
    if (!projectVersion) {
      throw new BadRequestException('Project version does not belong to the selected project.');
    }

    const requirements = await this.prisma.requirement.findMany({
      where: {
        id: { in: requirementIds },
        projectId: dto.projectId,
        versionId: dto.projectVersionId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (requirements.length !== requirementIds.length) {
      throw new BadRequestException(
        'Some requirements do not belong to the selected project version.',
      );
    }

    const workflows = await this.prisma.workflowRun.findMany({
      where: { id: { in: workflowRunIds }, requirementId: { in: requirementIds } },
      select: { id: true, status: true, requirementId: true },
    });
    if (workflows.length !== workflowRunIds.length) {
      throw new BadRequestException('Some workflow runs are not linked to the selected requirements.');
    }
    if (workflows.some((workflow) => workflow.status.toLowerCase() !== 'done')) {
      throw new BadRequestException('All linked development workflows must be completed before testing.');
    }

    if (!dto.testDesignId) {
      throw new BadRequestException({ code: 'TEST_REQUEST_DESIGN_REQUIRED', message: 'A confirmed test design is required before submitting for test.' });
    }
    const testDesign = await this.testDesigns.assertReadyForRequest(dto.testDesignId);
    if (testDesign.workspaceId !== dto.workspaceId || testDesign.projectId !== dto.projectId || testDesign.projectVersionId !== dto.projectVersionId) {
      throw new BadRequestException({ code: 'TEST_REQUEST_DESIGN_REQUIRED', message: 'Test design does not belong to the selected project scope.' });
    }
    if (requirementIds.some((id) => !testDesign.requirements.some((link) => link.requirementId === id)) || workflowRunIds.some((id) => !testDesign.workflowRuns.some((link) => link.workflowRunId === id))) {
      throw new BadRequestException({ code: 'TEST_REQUEST_DESIGN_REQUIRED', message: 'Test design does not cover all selected requirements and workflows.' });
    }

    if (artifactIds.length) {
      const artifacts = await this.prisma.artifact.findMany({
        where: {
          id: { in: artifactIds },
          workspaceId: dto.workspaceId,
          status: { not: 'DELETED' },
          OR: [{ projectId: null }, { projectId: dto.projectId }],
        },
        select: { id: true },
      });
      if (artifacts.length !== artifactIds.length) {
        throw new BadRequestException('Some artifacts are outside the selected project scope.');
      }
    }

    const requestId = await this.prisma.$transaction(async (tx) => {
      const createdRequest = await tx.testRequest.create({
        data: {
          workspaceId: dto.workspaceId,
          projectId: dto.projectId,
          projectVersionId: dto.projectVersionId,
          testDesignId: testDesign.id,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          traceId: randomUUID(),
          createdByUserId: userId ?? null,
          requirementLinks: { create: requirementIds.map((requirementId) => ({ requirementId })) },
          workflowLinks: { create: workflowRunIds.map((workflowRunId) => ({ workflowRunId })) },
          artifactLinks: artifactIds.length
            ? { create: artifactIds.map((artifactId) => ({ artifactId })) }
            : undefined,
        },
        select: { id: true },
      });
      const plan = await tx.testPlan.create({
        data: {
          testRequestId: createdRequest.id,
          testDesignId: testDesign.id,
          snapshots: {
            create: [
              ...testDesign.candidates
                .filter((candidate) => candidate.resolution === 'ACCEPTED' && candidate.action !== 'EXCLUDE')
                .map((candidate) => {
                  const proposed = asCaseRecord(candidate.proposedCase);
                  return {
                    sourceDefinitionId: candidate.sourceDefinitionId,
                    sourceVersion: candidate.sourceVersion,
                    title: proposed.title,
                    priority: proposed.priority,
                    precondition: proposed.precondition,
                    testData: proposed.testData !== undefined ? proposed.testData : candidate.sourceDefinition?.testData ?? null,
                    targetKeys: proposed.targetKeys !== undefined ? proposed.targetKeys : candidate.sourceDefinition?.targetKeys ?? Prisma.DbNull,
                    steps: proposed.steps as Prisma.InputJsonValue,
                    expected: proposed.expected,
                    metadata: { kind: 'FUNCTIONAL', origin: candidate.action === 'CREATE' ? 'GENERATED' : 'LIBRARY', selectionReason: candidate.matchReason, coverageKeys: candidate.coverageKeys },
                    selectedBy: candidate.matchReason === '测试人员手工补选' ? 'MANUAL' : 'AI',
                    selectionReason: candidate.matchReason,
                    impactLevel: 'HIGH',
                    kind: 'FUNCTIONAL',
                    origin: candidate.action === 'CREATE' ? 'GENERATED' : 'LIBRARY',
                  };
                }),
              ...testDesign.smokeCases
                .filter((smoke) => smoke.resolution === 'ACCEPTED')
                .map((smoke) => ({
                  sourceDefinitionId: null,
                  sourceVersion: null,
                  title: smoke.title,
                  priority: smoke.priority,
                  precondition: smoke.precondition,
                  steps: smoke.steps as Prisma.InputJsonValue,
                  expected: smoke.expected,
                  metadata: {
                    coverageKeys: smoke.coverageKeys,
                    blocking: smoke.blocking,
                  },
                  selectedBy: 'AI',
                  selectionReason: '本次改动动态生成的冒烟用例',
                  impactLevel: 'CRITICAL',
                  kind: 'SMOKE',
                  origin: 'GENERATED',
                })),
            ],
          },
        },
      });
      return createdRequest.id;
    });
    return this.getRequest(requestId);
  }

  listRequests(filters: { projectId?: string; projectVersionId?: string; status?: string }) {
    return this.prisma.testRequest.findMany({
      where: {
        projectId: filters.projectId,
        projectVersionId: filters.projectVersionId,
        status: filters.status,
      },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRequest(id: string) {
    const request = await this.prisma.testRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
    if (!request) {
      throw new NotFoundException('Test request not found.');
    }
    return request;
  }

  async addScopeCases(id: string, dto: AddTestScopeCasesDto, userId?: string) {
    const request = await this.prisma.testRequest.findUnique({
      where: { id },
      include: { testPlan: true },
    });
    if (!request) {
      throw new NotFoundException('Test request not found.');
    }
    if (request.status !== TestRequestStatus.DRAFT) {
      throw new BadRequestException('Test scope can only be changed while the request is in DRAFT.');
    }

    if (request.scopeGenerationStatus === 'COMPLETED' || request.testPlan?.status === 'READY') {
      throw new ConflictException('测试范围已完成并冻结，不能在等待冒烟或执行期间修改快照。');
    }

    const selections = dedupeSelections(dto.selections);
    const caseIds = selections.map((selection) => selection.caseId);
    const definitions = await this.prisma.testCaseDefinition.findMany({
      where: {
        id: { in: caseIds },
        status: 'ACTIVE',
        library: {
          workspaceId: request.workspaceId,
          OR: [{ projectId: null }, { projectId: request.projectId }],
        },
      },
    });
    if (definitions.length !== caseIds.length) {
      throw new BadRequestException('Some test cases are outside the shared or current project library.');
    }

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.testRequest.updateMany({
        where: { id, status: TestRequestStatus.DRAFT, scopeRevision: request.scopeRevision, scopeGenerationStatus: { not: 'COMPLETED' } },
        data: { scopeRevision: { increment: 1 }, scopeGenerationStatus: 'NOT_STARTED' },
      });
      if (changed.count !== 1) throw new ConflictException('测试范围或状态已变化，请刷新后重试。');
      const plan = await tx.testPlan.upsert({
        where: { testRequestId: id },
        update: {},
        create: { testRequestId: id, testDesignId: request.testDesignId ?? null, createdByUserId: userId ?? null },
      });
      const selectionByCase = new Map(selections.map((selection) => [selection.caseId, selection]));
      await Promise.all(
        definitions.map((definition) => {
          const selection = selectionByCase.get(definition.id)!;
          const snapshot = {
            title: definition.title,
            priority: definition.priority,
            precondition: definition.precondition,
            testData: definition.testData,
            targetKeys: definition.targetKeys ?? Prisma.DbNull,
            steps: definition.steps as unknown as Prisma.InputJsonValue,
            expected: definition.expected,
            metadata: definition.metadata ?? Prisma.JsonNull,
            selectedBy: 'AI',
            selectionReason: selection.reason.trim(),
            impactLevel: selection.impactLevel,
          };
          return tx.testCaseSnapshot.upsert({
            where: {
              testPlanId_sourceDefinitionId_sourceVersion: {
                testPlanId: plan.id,
                sourceDefinitionId: definition.id,
                sourceVersion: definition.version,
              },
            },
            update: snapshot,
            create: {
              testPlanId: plan.id,
              sourceDefinitionId: definition.id,
              sourceVersion: definition.version,
              ...snapshot,
            },
          });
        }),
      );
    });

    return this.getRequest(id);
  }

  async prepare(id: string, dto: PrepareTestRequestDto) {
    if (!Number.isInteger(dto.scopeRevision) || dto.scopeRevision < 0) throw new BadRequestException('scopeRevision 必须为非负整数。');
    return this.completeScope(id, { scopeRevision: dto.scopeRevision, summary: '', coverageChecks: [], excludedScopes: [] }, { useConfirmedDesign: true });
  }

  async completeScope(id: string, dto: CompleteTestScopeDto, options: { useConfirmedDesign?: boolean } = {}) {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.testRequest.findUnique({
        where: { id },
        include: {
          testDesign: true,
          testPlan: { include: {
            snapshots: { select: { id: true, kind: true } },
            runs: { where: { runType: 'LOCAL_SMOKE' }, select: { id: true, status: true }, orderBy: { createdAt: 'desc' } },
          } },
          workflowLinks: { include: { workflowRun: { select: { status: true } } } },
        },
      });
      if (!request) throw new NotFoundException('Test request not found.');
      if (![TestRequestStatus.DRAFT, TestRequestStatus.READY].includes(request.status as TestRequestStatus)) throw new ConflictException('提测单已开始执行或结束，不能重复准备。');
      const design = request.testDesign;
      if (!design || design.status !== 'CONFIRMED' || design.id !== request.testDesignId || design.workspaceId !== request.workspaceId || design.projectId !== request.projectId || design.projectVersionId !== request.projectVersionId) throw new BadRequestException('请先确认当前项目与版本的测试设计。');
      if (!request.testPlan?.snapshots.length || request.testPlan.testDesignId !== design.id) throw new BadRequestException('当前确认设计尚未冻结有效测试快照。');
      if (!request.workflowLinks.length || request.workflowLinks.some(link => link.workflowRun.status.toLowerCase() !== 'done')) throw new BadRequestException('所有关联研发工作流必须完成后才能准备提测。');

      const scope = options.useConfirmedDesign ? {
        summary: '已按确认测试设计准备测试范围。',
        coverageChecks: confirmedCoverageChecks(design.coverageChecks),
        excludedScopes: confirmedUncoveredItems(design.uncoveredItems),
      } : dto;
      const failedChecks = scope.coverageChecks.filter(check => !check.passed);
      if (failedChecks.length) throw new BadRequestException({ code: 'TEST_SCOPE_INCOMPLETE', message: 'Test scope coverage checks are incomplete.', failedChecks });
      const revision = dto.scopeRevision ?? request.scopeRevision;
      const completed = request.scopeGenerationStatus === 'COMPLETED' && request.testPlan.status === 'READY';
      if (completed) {
        // 已完成范围的原请求重试和读取当前版本均幂等，不能覆盖检查或推进执行状态。
        if (revision !== request.scopeRevision && revision !== request.scopeRevision - 1) throw new ConflictException('测试范围版本已变化，请刷新后重试。');
        return;
      }
      if (revision !== request.scopeRevision) throw new ConflictException('测试范围版本已变化，请刷新后重试。');
      assertTestRequestTransition(request.status as TestRequestStatus, TestRequestStatus.READY);
      const hasSmoke = request.testPlan.snapshots.some(snapshot => snapshot.kind === 'SMOKE');
      const waitsForLocalSmoke = hasSmoke && !request.testPlan.runs.some(run => run.status === 'PASSED');
      const changed = await tx.testRequest.updateMany({
        where: { id, status: request.status, scopeRevision: request.scopeRevision, scopeGenerationStatus: request.scopeGenerationStatus },
        data: {
          status: waitsForLocalSmoke ? TestRequestStatus.DRAFT : TestRequestStatus.READY,
          scopeGenerationStatus: 'COMPLETED', scopeSummary: scope.summary.trim(), scopeRevision: { increment: 1 },
          scopeChecks: scope.coverageChecks as unknown as Prisma.InputJsonValue,
          excludedScopes: scope.excludedScopes as Prisma.InputJsonValue,
        },
      });
      if (changed.count !== 1) throw new ConflictException('测试范围或状态已变化，请刷新后重试。');
      await tx.testPlan.update({ where: { id: request.testPlan.id }, data: { status: 'READY' } });
    });
    return this.getRequest(id);
  }

}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function dedupeSelections<T extends { caseId: string }>(selections: T[]): T[] {
  const byCaseId = new Map<string, T>();
  for (const selection of selections) {
    byCaseId.set(selection.caseId, selection);
  }
  return [...byCaseId.values()];
}

function asCaseRecord(value: Prisma.JsonValue): {
  title: string;
  priority: string;
  precondition: string | null;
  steps: string[];
  expected: string;
  testData?: string | null;
  targetKeys?: string[];
} {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
  return {
    title: typeof item.title === 'string' ? item.title : '未命名测试用例',
    priority: typeof item.priority === 'string' ? item.priority : 'P2',
    precondition: typeof item.precondition === 'string' ? item.precondition : null,
    steps: Array.isArray(item.steps) ? item.steps.filter((step): step is string => typeof step === 'string') : [],
    expected: typeof item.expected === 'string' ? item.expected : '结果符合预期',
    ...(typeof item.testData === 'string' || item.testData === null ? { testData: item.testData } : {}),
    ...(Array.isArray(item.targetKeys) ? { targetKeys: item.targetKeys.filter((key): key is string => typeof key === 'string') } : {}),
  };
}

function confirmedCoverageChecks(value: Prisma.JsonValue): CompleteTestScopeDto['coverageChecks'] {
  if (!Array.isArray(value)) throw new BadRequestException('确认设计缺少覆盖检查。');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.key !== 'string' || !item.key.trim() || typeof item.passed !== 'boolean') throw new BadRequestException('确认设计覆盖检查格式无效。');
    return { key: item.key, passed: item.passed, ...(typeof item.detail === 'string' ? { detail: item.detail } : {}) };
  });
}
function confirmedUncoveredItems(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new BadRequestException('确认设计未覆盖范围格式无效。');
  return value as string[];
}
