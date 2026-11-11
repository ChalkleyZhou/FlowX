import { browseScope, scopeModuleIds, type ScopeBrowseQuery } from './test-request-scope-browse';
import { listReportBaselines, listReportSupersessions, listRequestCases, type ReportBrowseQuery } from './test-request-browse';
import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AddTestScopeCasesDto, AssignTestRequestCasesDto, CompleteTestScopeDto, CreateTestRequestDto, PrepareTestRequestDto, SaveGeneratedTestCaseDto, UpdateTestRequestScopeDraftDto, UpdateTestScopeModuleDto } from './dto/test-request.dto';
import { TestRequestStatus, assertTestRequestTransition } from './quality-status';
import { TestDesignsService } from './test-designs.service';
import { CaseLibrariesService } from './case-libraries.service';

const requestInclude = {
  project: true,
  projectVersion: true,
  requirementLinks: { include: { requirement: true } },
  workflowLinks: { include: { workflowRun: true } },
  artifactLinks: { include: { artifact: true } },
  testDesign: {
    include: {
      candidates: { orderBy: { sortOrder: 'asc' as const }, include: { sourceDefinition: { include: { library: true, module: true } } } },
      smokeCases: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
  testPlan: {
    include: {
      snapshots: { orderBy: { createdAt: 'asc' as const } },
      runs: { orderBy: { createdAt: 'desc' as const } },
    },
  },
} as const;

const requestBrowseInclude = {
  project: true, projectVersion: true,
  _count: { select: { requirementLinks: true, workflowLinks: true, artifactLinks: true } },
  testPlan: { include: { _count: { select: { snapshots: true, runs: true } } } },
  testDesign: { include: { _count: { select: { candidates: true } } } },
} as const;

@Injectable()
export class TestRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly testDesigns: TestDesignsService,
    @Optional() private readonly caseLibraries?: CaseLibrariesService,
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

    if (!dto.testDesignId && typeof this.testDesigns.createDesign !== 'function') {
      throw new BadRequestException({ code: 'TEST_REQUEST_DESIGN_REQUIRED', message: 'A confirmed test design is required before submitting for test.' });
    }
    let testDesign = dto.testDesignId
      ? await this.testDesigns.assertReadyForRequest(dto.testDesignId)
      : await this.testDesigns.createDesign({
        workspaceId: dto.workspaceId,
        projectId: dto.projectId,
        projectVersionId: dto.projectVersionId,
        requirementIds,
        workflowRunIds,
      });
    if (testDesign.workspaceId !== dto.workspaceId || testDesign.projectId !== dto.projectId || testDesign.projectVersionId !== dto.projectVersionId) {
      throw new BadRequestException({ code: 'TEST_REQUEST_DESIGN_REQUIRED', message: 'Test design does not belong to the selected project scope.' });
    }
    if (requirementIds.some((id) => !testDesign.requirements.some((link) => link.requirementId === id)) || workflowRunIds.some((id) => !testDesign.workflowRuns.some((link) => link.workflowRunId === id))) {
      throw new BadRequestException({ code: 'TEST_REQUEST_DESIGN_REQUIRED', message: 'Test design does not cover all selected requirements and workflows.' });
    }
    const shouldGenerate = !dto.testDesignId;
    if (shouldGenerate) {
      testDesign = await this.testDesigns.generate(testDesign.id);
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
          scopeCases: {
            create: [
              ...testDesign.candidates.map((candidate) => {
                const proposed = asCaseRecord(candidate.proposedCase);
                return {
                  sourceDefinitionId: candidate.sourceDefinitionId,
                  sourceVersion: candidate.sourceVersion,
                  libraryId: candidate.sourceDefinition?.libraryId ?? null,
                  moduleId: candidate.sourceDefinition?.moduleId ?? null,
                  moduleName: null,
                  action: candidate.action,
                  status: candidate.resolution === 'REJECTED' || candidate.action === 'EXCLUDE' ? 'REMOVED' : 'INCLUDED',
                  title: proposed.title,
                  priority: proposed.priority,
                  precondition: proposed.precondition,
                  testData: proposed.testData ?? candidate.sourceDefinition?.testData ?? null,
                  targetKeys: proposed.targetKeys ?? candidate.sourceDefinition?.targetKeys ?? Prisma.DbNull,
                  steps: proposed.steps as Prisma.InputJsonValue,
                  expected: proposed.expected,
                  metadata: { candidateId: candidate.id, kind: 'FUNCTIONAL' },
                  coverageKeys: candidate.coverageKeys ?? [],
                  matchReason: candidate.matchReason,
                  origin: candidate.action === 'CREATE' ? 'GENERATED' : 'LIBRARY',
                  sortOrder: candidate.sortOrder,
                };
              }),
              ...testDesign.smokeCases.map((smoke) => ({
                action: 'CREATE',
                status: smoke.resolution === 'REJECTED' ? 'REMOVED' : 'INCLUDED',
                title: smoke.title,
                priority: smoke.priority,
                precondition: smoke.precondition,
                steps: smoke.steps as Prisma.InputJsonValue,
                expected: smoke.expected,
                metadata: { smokeCaseId: smoke.id, kind: 'SMOKE', blocking: smoke.blocking },
                coverageKeys: (smoke.coverageKeys ?? []) as Prisma.InputJsonValue,
                matchReason: '本次改动动态生成的冒烟用例',
                origin: 'GENERATED',
                sortOrder: smoke.sortOrder,
              })),
            ],
          },
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

  async listRequests(filters: PaginationQuery & { projectId?: string; projectVersionId?: string; status?: string; q?: string }) {
    const paging = parsePagination(filters);
    const scope: Prisma.TestRequestWhereInput = {
      projectId: filters.projectId, projectVersionId: filters.projectVersionId,
      ...(filters.q?.trim() ? { title: { contains: filters.q.trim() } } : {}),
    };
    const where = { ...scope, status: filters.status };
    const [items, total, groups] = await Promise.all([
      this.prisma.testRequest.findMany({ where, include: requestBrowseInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: paging.skip, take: paging.take }),
      this.prisma.testRequest.count({ where }),
      this.prisma.testRequest.groupBy({ by: ['status'], where: scope, _count: true }),
    ]);
    const counts = Object.fromEntries(groups.map(group => [group.status, group._count]));
    return { ...pageResult(items, total, paging), summary: { ...counts, activeCount: (counts.IN_TEST ?? 0), readyCount: counts.READY ?? 0, passedCount: counts.PASSED ?? 0, exceptionCount: (counts.FAILED ?? 0) + (counts.BLOCKED ?? 0) } };
  }

  async getRequestBrowse(id: string) {
    const request = await this.prisma.testRequest.findUnique({ where: { id }, include: requestBrowseInclude });
    if (!request) throw new NotFoundException('Test request not found.');
    return request;
  }

  async listSnapshots(id: string, query: PaginationQuery & { q?: string; kind?: string }) {
    await this.getRequestBrowse(id);
    const paging = parsePagination(query);
    const where: Prisma.TestCaseSnapshotWhereInput = { testPlan: { testRequestId: id }, kind: query.kind, ...(query.q?.trim() ? { title: { contains: query.q.trim() } } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.testCaseSnapshot.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: paging.skip, take: paging.take }),
      this.prisma.testCaseSnapshot.count({ where }),
    ]);
    const [functionalCount, smokeCount] = await Promise.all([
      this.prisma.testCaseSnapshot.count({ where: { ...where, kind: 'FUNCTIONAL' } }),
      this.prisma.testCaseSnapshot.count({ where: { ...where, kind: 'SMOKE' } }),
    ]);
    return { ...pageResult(items, total, paging), summary: { functionalCount, smokeCount } };
  }

  async listLinks(id: string, kind: 'requirements' | 'workflows' | 'artifacts', query: PaginationQuery) {
    await this.getRequestBrowse(id);
    const paging = parsePagination(query);
    const where = { testRequestId: id };
    if (kind === 'requirements') {
      const [items, total] = await Promise.all([this.prisma.testRequestRequirement.findMany({ where, include: { requirement: true }, orderBy: [{ createdAt: 'asc' }, { requirementId: 'asc' }], skip: paging.skip, take: paging.take }), this.prisma.testRequestRequirement.count({ where })]);
      return pageResult(items, total, paging);
    }
    if (kind === 'workflows') {
      const [items, total] = await Promise.all([this.prisma.testRequestWorkflowRun.findMany({ where, include: { workflowRun: true }, orderBy: [{ createdAt: 'asc' }, { workflowRunId: 'asc' }], skip: paging.skip, take: paging.take }), this.prisma.testRequestWorkflowRun.count({ where })]);
      return pageResult(items, total, paging);
    }
    const [items, total] = await Promise.all([this.prisma.testRequestArtifact.findMany({ where, include: { artifact: true }, orderBy: [{ createdAt: 'asc' }, { artifactId: 'asc' }], skip: paging.skip, take: paging.take }), this.prisma.testRequestArtifact.count({ where })]);
    return pageResult(items, total, paging);
  }

  async reportBaselines(id: string, query: ReportBrowseQuery) { await this.getRequestBrowse(id); return listReportBaselines(this.prisma, id, query); }
  async reportSupersessions(id: string, query: ReportBrowseQuery) { await this.getRequestBrowse(id); return listReportSupersessions(this.prisma, id, query); }
  async listCases(id: string, query: PaginationQuery & { result?: string; q?: string; selectedRunIds?: string | string[] }) { await this.getRequestBrowse(id); return listRequestCases(this.prisma, id, query); }

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

  async getScopeDraft(id: string, query: ScopeBrowseQuery = {}) {
    if (query.view) return browseScope(this.prisma, id, query);
    const request = await this.prisma.testRequest.findUnique({
      where: { id },
      select: { id: true, scopeRevision: true, scopeGenerationStatus: true, testDesignId: true },
    });
    if (!request) throw new NotFoundException('Test request not found.');
    if (!request.testDesignId) return { items: [], total: 0, page: 1, pageSize: query.pageSize ?? 20, totalPages: 0, scopeRevision: request.scopeRevision, status: request.scopeGenerationStatus };
    const paging = parsePagination(query);
    const where: Prisma.TestDesignCandidateWhereInput = {
      testDesignId: request.testDesignId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.q?.trim() ? { proposedCase: { path: '$.title', string_contains: query.q.trim() } } : {}),
    };
    const [items, total, groups] = await Promise.all([
      this.prisma.testDesignCandidate.findMany({
        where,
        include: { sourceDefinition: { include: { library: true, module: true } } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.testDesignCandidate.count({ where }),
      this.prisma.testDesignCandidate.groupBy({ by: ['action'], where, _count: true }),
    ]);
    return { ...pageResult(items, total, paging), scopeRevision: request.scopeRevision, status: request.scopeGenerationStatus, summary: Object.fromEntries(groups.map(group => [group.action, group._count])) };
  }

  async updateScopeDraft(id: string, dto: UpdateTestRequestScopeDraftDto) {
    const candidateIds = unique(dto.removedCandidateIds);
    const restoredIds = unique(dto.restoredCandidateIds ?? []);
    if (candidateIds.some(id => restoredIds.includes(id))) throw new BadRequestException('同一用例不能同时移除和恢复。');
    await this.prisma.$transaction(async tx => {
      const request = await tx.testRequest.findUnique({ where: { id }, select: { status: true, scopeRevision: true, testDesignId: true, testPlan: { select: { snapshots: { take: 1, select: { id: true } } } } } });
      if (!request) throw new NotFoundException('Test request not found.');
      if (request.status !== TestRequestStatus.DRAFT || !request.testDesignId) throw new BadRequestException('当前提测不允许修改范围草稿。');
      if (request.testPlan?.snapshots.length) throw new ConflictException('测试范围已确认，不能继续修改用例。');
      const changed = await tx.testRequest.updateMany({ where: { id, status: TestRequestStatus.DRAFT, scopeRevision: dto.scopeRevision }, data: { scopeRevision: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException('测试范围版本已变化，请刷新后重试。');
      if (restoredIds.length) {
        const rows = await tx.testDesignCandidate.findMany({ where: { id: { in: restoredIds }, testDesignId: request.testDesignId } });
        if (rows.length !== restoredIds.length) throw new BadRequestException('部分候选不属于当前提测范围。');
        await tx.testDesignCandidate.updateMany({ where: { id: { in: restoredIds }, testDesignId: request.testDesignId, action: 'EXCLUDE' }, data: { action: 'REUSE' } });
        await tx.testDesignCandidate.updateMany({ where: { id: { in: restoredIds }, testDesignId: request.testDesignId }, data: { resolution: 'ACCEPTED', decisionNote: '恢复到本次提测范围' } });
        const scopeCases = await tx.testRequestScopeCase.findMany({ where: { testRequestId: id }, select: { id: true, metadata: true } });
        const scopeIds = scopeCases.filter(row => {
          const metadata = row.metadata as Record<string, unknown> | null;
          return typeof metadata?.candidateId === 'string' && restoredIds.includes(metadata.candidateId);
        }).map(row => row.id);
        if (scopeIds.length) await tx.testRequestScopeCase.updateMany({ where: { id: { in: scopeIds }, testRequestId: id }, data: { status: 'INCLUDED' } });
      }
      if (candidateIds.length) {
        const result = await tx.testDesignCandidate.updateMany({ where: { id: { in: candidateIds }, testDesignId: request.testDesignId }, data: { resolution: 'REJECTED', decisionNote: '从本次提测范围移除' } });
        if (result.count !== candidateIds.length) throw new BadRequestException('部分候选不属于当前提测范围。');
        const scopeCases = await tx.testRequestScopeCase.findMany({ where: { testRequestId: id }, select: { id: true, metadata: true } });
        const removedScopeCaseIds = scopeCases.filter(scopeCase => {
          const metadata = scopeCase.metadata && typeof scopeCase.metadata === 'object' && !Array.isArray(scopeCase.metadata)
            ? scopeCase.metadata as Record<string, Prisma.JsonValue>
            : {};
          return typeof metadata.candidateId === 'string' && candidateIds.includes(metadata.candidateId);
        }).map(scopeCase => scopeCase.id);
        if (removedScopeCaseIds.length) {
          await tx.testRequestScopeCase.updateMany({ where: { id: { in: removedScopeCaseIds }, testRequestId: id }, data: { status: 'REMOVED' } });
        }
      }
    });
    return this.getRequest(id);
  }

  async addScopeDraftCases(id: string, dto: AddTestScopeCasesDto, userId?: string) {
    const request = await this.prisma.testRequest.findUnique({
      where: { id },
      select: { id: true, status: true, workspaceId: true, projectId: true, testDesignId: true, scopeRevision: true, scopeGenerationStatus: true, testPlan: { select: { snapshots: { select: { id: true }, take: 1 } } } },
    });
    if (!request) throw new NotFoundException('Test request not found.');
    if (request.status !== TestRequestStatus.DRAFT || !request.testDesignId) throw new BadRequestException('当前提测不允许补充范围。');
    if (request.testPlan?.snapshots.length) throw new ConflictException('测试范围已确认，不能继续补充用例。');
    const selections = dedupeSelections(dto.selections);
    const caseIds = selections.map(selection => selection.caseId);
    const definitions = await this.prisma.testCaseDefinition.findMany({
      where: { id: { in: caseIds }, status: 'ACTIVE', library: { workspaceId: request.workspaceId, OR: [{ projectId: null }, { projectId: request.projectId }] } },
      include: { library: true, module: true },
    });
    if (definitions.length !== caseIds.length) throw new BadRequestException('部分用例不属于当前项目或共享用例库。');
    const existing = await this.prisma.testDesignCandidate.findMany({ where: { testDesignId: request.testDesignId, sourceDefinitionId: { in: caseIds } }, select: { id: true, sourceDefinitionId: true, resolution: true, action: true } });
    const existingIds = new Set(existing.map(item => item.sourceDefinitionId).filter((value): value is string => Boolean(value)));
    const additions = definitions.filter(definition => !existingIds.has(definition.id));
    const restorations = existing.filter(item => item.resolution === 'REJECTED' || item.action === 'EXCLUDE');
    if (dto.scopeRevision !== undefined && dto.scopeRevision !== request.scopeRevision) throw new ConflictException('测试范围版本已变化，请刷新后重试。');
    if (!additions.length && !restorations.length) return this.getRequest(id);
    await this.prisma.$transaction(async tx => {
      const changed = await tx.testRequest.updateMany({ where: { id, status: TestRequestStatus.DRAFT, scopeRevision: request.scopeRevision }, data: { scopeRevision: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException('测试范围版本已变化，请刷新后重试。');
      if (restorations.length) {
        const ids = restorations.map(item => item.id);
        await tx.testDesignCandidate.updateMany({ where: { id: { in: ids }, testDesignId: request.testDesignId!, action: 'EXCLUDE' }, data: { action: 'REUSE' } });
        await tx.testDesignCandidate.updateMany({ where: { id: { in: ids }, testDesignId: request.testDesignId! }, data: { resolution: 'ACCEPTED', decisionNote: '恢复到本次提测范围' } });
        await tx.testRequestScopeCase.updateMany({ where: { testRequestId: id, sourceDefinitionId: { in: restorations.flatMap(item => item.sourceDefinitionId ? [item.sourceDefinitionId] : []) } }, data: { status: 'INCLUDED' } });
      }
      const current = await tx.testDesignCandidate.aggregate({ where: { testDesignId: request.testDesignId! }, _max: { sortOrder: true } });
      const baseSortOrder = (current._max.sortOrder ?? -1) + 1;
      const selectionByCase = new Map(selections.map(selection => [selection.caseId, selection]));
      for (const [index, definition] of additions.entries()) {
        const selection = selectionByCase.get(definition.id)!;
        const proposedCase = { title: definition.title, priority: definition.priority, precondition: definition.precondition, testData: definition.testData, targetKeys: definition.targetKeys ?? [], steps: definition.steps, expected: definition.expected, tags: definition.tags ?? [] };
        const candidate = await tx.testDesignCandidate.create({ data: { testDesignId: request.testDesignId!, sourceDefinitionId: definition.id, sourceVersion: definition.version, coverageKeys: [], action: 'REUSE', resolution: 'ACCEPTED', matchReason: selection.reason.trim() || '测试人员手工补选', sortOrder: baseSortOrder + index, proposedCase } });
        await tx.testRequestScopeCase.create({ data: { testRequestId: id, sourceDefinitionId: definition.id, sourceVersion: definition.version, libraryId: definition.libraryId, moduleId: definition.moduleId, moduleName: definition.module?.name ?? null, action: 'REUSE', status: 'INCLUDED', title: definition.title, priority: definition.priority, precondition: definition.precondition, testData: definition.testData, targetKeys: definition.targetKeys ?? Prisma.DbNull, steps: definition.steps as Prisma.InputJsonValue, expected: definition.expected, metadata: { candidateId: candidate.id, kind: 'FUNCTIONAL', selectedBy: userId ?? null }, coverageKeys: [], matchReason: selection.reason.trim() || '测试人员手工补选', origin: 'LIBRARY', sortOrder: baseSortOrder + index } });
      }
    }, { timeout: 30_000 });
    return this.getRequest(id);
  }

  async updateScopeModule(id: string, dto: UpdateTestScopeModuleDto, userId?: string) {
    const request = await this.prisma.testRequest.findUnique({ where: { id }, select: { workspaceId: true, projectId: true, testDesignId: true, scopeRevision: true, status: true, testPlan: { select: { snapshots: { take: 1, select: { id: true } } } } } });
    if (!request) throw new NotFoundException('Test request not found.');
    if (request.status !== TestRequestStatus.DRAFT || !request.testDesignId) throw new BadRequestException('当前提测不允许修改范围草稿。');
    if (request.testPlan?.snapshots.length) throw new ConflictException('测试范围已确认，不能继续修改用例。');
    if (request.scopeRevision !== dto.scopeRevision) throw new ConflictException('测试范围版本已变化，请刷新后重试。');
    const moduleIds = await scopeModuleIds(this.prisma, dto.moduleId, request.workspaceId, request.projectId);
    if (dto.included) {
      const cases = await this.prisma.testCaseDefinition.findMany({ where: { moduleId: { in: moduleIds }, status: 'ACTIVE', library: { workspaceId: request.workspaceId, OR: [{ projectId: null }, { projectId: request.projectId }] } }, select: { id: true } });
      if (!cases.length) return this.getRequest(id);
      return this.addScopeDraftCases(id, { scopeRevision: dto.scopeRevision, selections: cases.map(item => ({ caseId: item.id, reason: '人工补充提测范围', impactLevel: 'MEDIUM' })) }, userId);
    }
    const rows = await this.prisma.testDesignCandidate.findMany({ where: { testDesignId: request.testDesignId ?? '__none__', sourceDefinition: { moduleId: { in: moduleIds } }, resolution: { not: 'REJECTED' }, action: { not: 'EXCLUDE' } }, select: { id: true } });
    return this.updateScopeDraft(id, { scopeRevision: dto.scopeRevision, removedCandidateIds: rows.map(row => row.id) });
  }

  async saveGeneratedCaseToLibrary(id: string, candidateId: string, dto: SaveGeneratedTestCaseDto, userId?: string) {
    if (!this.caseLibraries) throw new BadRequestException('用例库服务暂不可用。');
    const request = await this.prisma.testRequest.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, projectId: true, status: true, testDesignId: true },
    });
    if (!request) throw new NotFoundException('Test request not found.');
    if (request.status !== TestRequestStatus.DRAFT || !request.testDesignId) throw new BadRequestException('当前提测不允许保存 AI 新用例。');

    const candidate = await this.prisma.testDesignCandidate.findFirst({
      where: { id: candidateId, testDesignId: request.testDesignId },
      include: { sourceDefinition: true },
    });
    if (!candidate) throw new NotFoundException('AI 用例候选不存在。');
    if (candidate.action !== 'CREATE') throw new BadRequestException('只有 AI 新用例可以保存到用例库。');
    if (candidate.sourceDefinitionId) throw new ConflictException('该 AI 新用例已经保存到用例库。');

    const library = await this.prisma.testCaseLibrary.findFirst({
      where: {
        id: dto.libraryId,
        workspaceId: request.workspaceId,
        status: 'ACTIVE',
        OR: [{ projectId: null }, { projectId: request.projectId }],
      },
    });
    if (!library) throw new BadRequestException('目标用例库不属于当前项目范围。');

    const proposed = asCaseRecord(candidate.proposedCase);
    const testCase = await this.caseLibraries.createCase(library.id, {
      moduleId: dto.moduleId,
      title: proposed.title,
      priority: ['P0', 'P1', 'P2', 'P3'].includes(proposed.priority) ? proposed.priority as 'P0' | 'P1' | 'P2' | 'P3' : 'P2',
      precondition: proposed.precondition ?? undefined,
      testData: proposed.testData ?? undefined,
      targetKeys: proposed.targetKeys,
      steps: proposed.steps,
      expected: proposed.expected,
      metadata: { origin: 'AI_TEST_REQUEST_SCOPE', candidateId },
    }, userId);
    await this.prisma.testDesignCandidate.update({
      where: { id: candidate.id },
      data: { sourceDefinitionId: testCase.id, sourceVersion: testCase.version },
    });
    await this.prisma.testRequestScopeCase.updateMany({
      where: { testRequestId: id, metadata: { path: '$.candidateId', equals: candidate.id } },
      data: { sourceDefinitionId: testCase.id, sourceVersion: testCase.version, libraryId: library.id, moduleId: dto.moduleId ?? null, origin: 'LIBRARY' },
    });
    return { candidateId: candidate.id, testCase };
  }

  async listAssignments(id: string, query: PaginationQuery & { q?: string; unassigned?: string } = {}) {
    const request = await this.prisma.testRequest.findUnique({ where: { id }, include: { testPlan: true } });
    if (!request) throw new NotFoundException('Test request not found.');
    if (!request.testPlan) return { items: [], total: 0, page: 1, pageSize: query.pageSize ?? 20, totalPages: 0, summary: { total: 0, assigned: 0, unassigned: 0 }, scopeRevision: request.scopeRevision };
    const paging = parsePagination(query);
    const where: Prisma.TestCaseSnapshotWhereInput = {
      testPlanId: request.testPlan.id,
      kind: 'FUNCTIONAL',
      ...(query.unassigned === 'true' ? { assignedToUserId: null } : {}),
      ...(query.q?.trim() ? { OR: [{ title: { contains: query.q.trim() } }, { moduleName: { contains: query.q.trim() } }] } : {}),
    };
    const [items, total, assigned, all] = await Promise.all([
      this.prisma.testCaseSnapshot.findMany({ where, include: { assignedToUser: true }, orderBy: [{ moduleName: 'asc' }, { createdAt: 'asc' }], skip: paging.skip, take: paging.take }),
      this.prisma.testCaseSnapshot.count({ where }),
      this.prisma.testCaseSnapshot.count({ where: { testPlanId: request.testPlan.id, kind: 'FUNCTIONAL', assignedToUserId: { not: null } } }),
      this.prisma.testCaseSnapshot.count({ where: { testPlanId: request.testPlan.id, kind: 'FUNCTIONAL' } }),
    ]);
    return { ...pageResult(items, total, paging), summary: { total: all, assigned, unassigned: all - assigned }, scopeRevision: request.scopeRevision };
  }

  async updateAssignments(id: string, dto: AssignTestRequestCasesDto, userId?: string) {
    await this.prisma.$transaction(async tx => {
      const request = await tx.testRequest.findUnique({ where: { id }, include: { testPlan: true, workspace: { select: { organizationId: true } } } });
      if (!request?.testPlan) throw new NotFoundException('Test plan not found.');
      if (request.status !== TestRequestStatus.DRAFT && request.status !== TestRequestStatus.READY) throw new BadRequestException('当前提测不允许修改分派。');
      if (dto.scopeRevision !== request.scopeRevision) throw new ConflictException('测试范围版本已变化，请刷新后重试。');
      const snapshotIds = unique(dto.assignments.map(item => item.snapshotId));
      const snapshots = await tx.testCaseSnapshot.findMany({ where: { id: { in: snapshotIds }, testPlanId: request.testPlan.id, kind: 'FUNCTIONAL' }, select: { id: true } });
      if (snapshots.length !== snapshotIds.length) throw new BadRequestException('部分用例不属于当前提测范围。');
      const userIds = unique(dto.assignments.map(item => item.assignedToUserId ?? '').filter(Boolean));
      if (userIds.length) {
        const members = await tx.userOrganization.findMany({ where: { organizationId: request.workspace.organizationId, userId: { in: userIds }, user: { status: 'ACTIVE' } }, select: { userId: true } });
        if (members.length !== userIds.length) throw new BadRequestException('部分执行人不是当前组织的有效成员。');
      }
      for (const assignment of dto.assignments) {
        await tx.testCaseSnapshot.update({ where: { id: assignment.snapshotId }, data: { assignedToUserId: assignment.assignedToUserId ?? null, assignedByUserId: userId ?? null, assignedAt: assignment.assignedToUserId ? new Date() : null } });
      }
    });
    return this.listAssignments(id);
  }

  async completeAssignments(id: string, scopeRevision: number, userId?: string) {
    const assignments = await this.listAssignments(id, { page: 1, pageSize: 1 });
    if (assignments.scopeRevision !== scopeRevision) throw new ConflictException('测试范围版本已变化，请刷新后重试。');
    if (assignments.summary.unassigned > 0) throw new BadRequestException('仍有未分派的功能用例。');
    const changed = await this.prisma.testRequest.updateMany({
      where: { id, scopeRevision, status: { in: [TestRequestStatus.DRAFT, TestRequestStatus.READY] } },
      data: { scopeSummary: `${assignments.summary.total} 条功能用例已完成分派` },
    });
    if (changed.count !== 1) throw new ConflictException('当前提测已开始执行或状态已变化，不能完成分派。');
    return this.getRequest(id);
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
          testDesign: { include: {
            candidates: { orderBy: { sortOrder: 'asc' }, include: { sourceDefinition: { include: { library: true, module: true } } } },
            smokeCases: { orderBy: { sortOrder: 'asc' } },
          } },
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
      if (!design || !['WAITING_REVIEW', 'CONFIRMED'].includes(design.status) || design.id !== request.testDesignId || design.workspaceId !== request.workspaceId || design.projectId !== request.projectId || design.projectVersionId !== request.projectVersionId) throw new BadRequestException('请先完成 AI 测试范围分析。');
      if (!request.testPlan || request.testPlan.testDesignId !== design.id) throw new BadRequestException('当前提测没有可用测试计划。');
      if (design.status === 'WAITING_REVIEW' && request.testPlan.snapshots.length) throw new BadRequestException('当前测试设计尚未完成确认。');
      if (!request.testPlan.snapshots.length) {
        const functional = (design.candidates ?? []).filter(candidate => candidate.action !== 'EXCLUDE' && candidate.resolution !== 'REJECTED');
        const smoke = (design.smokeCases ?? []).filter(item => item.resolution !== 'REJECTED');
        if (!functional.length && !smoke.length) throw new BadRequestException('当前范围没有可执行用例。');
        await tx.testCaseSnapshot.createMany({
          data: [
            ...functional.map(candidate => {
              const proposed = asCaseRecord(candidate.proposedCase);
              return {
                testPlanId: request.testPlan!.id,
                sourceDefinitionId: candidate.sourceDefinitionId,
                sourceVersion: candidate.sourceVersion,
                libraryId: candidate.sourceDefinition?.libraryId ?? null,
                moduleId: candidate.sourceDefinition?.moduleId ?? null,
                moduleName: candidate.sourceDefinition?.module?.name ?? null,
                title: proposed.title,
                priority: proposed.priority,
                precondition: proposed.precondition,
                testData: proposed.testData ?? candidate.sourceDefinition?.testData ?? null,
                targetKeys: proposed.targetKeys ?? candidate.sourceDefinition?.targetKeys ?? Prisma.DbNull,
                steps: proposed.steps as Prisma.InputJsonValue,
                expected: proposed.expected,
                metadata: { coverageKeys: candidate.coverageKeys, matchReason: candidate.matchReason },
                selectedBy: candidate.matchReason === '测试人员手工补选' ? 'MANUAL' : 'AI',
                selectionReason: candidate.matchReason,
                impactLevel: 'HIGH',
                kind: 'FUNCTIONAL',
                origin: candidate.action === 'CREATE' ? 'GENERATED' : 'LIBRARY',
              };
            }),
            ...smoke.map(item => ({
              testPlanId: request.testPlan!.id,
              sourceDefinitionId: null,
              sourceVersion: null,
              title: item.title,
              priority: item.priority,
              precondition: item.precondition,
              steps: item.steps as Prisma.InputJsonValue,
              expected: item.expected,
              metadata: { coverageKeys: item.coverageKeys, blocking: item.blocking },
              selectedBy: 'AI',
              selectionReason: '本次改动动态生成的冒烟用例',
              impactLevel: 'CRITICAL',
              kind: 'SMOKE',
              origin: 'GENERATED',
            })),
          ],
        });
      }
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
