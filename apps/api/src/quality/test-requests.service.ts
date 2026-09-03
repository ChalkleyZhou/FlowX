import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AddTestScopeCasesDto, CompleteTestScopeDto, CreateTestRequestDto } from './dto/test-request.dto';
import { TestRequestStatus, assertTestRequestTransition } from './quality-status';

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
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.testRequest.create({
      data: {
        workspaceId: dto.workspaceId,
        projectId: dto.projectId,
        projectVersionId: dto.projectVersionId,
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
      include: requestInclude,
    });
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
      const plan = await tx.testPlan.upsert({
        where: { testRequestId: id },
        update: {},
        create: { testRequestId: id, createdByUserId: userId ?? null },
      });
      const selectionByCase = new Map(selections.map((selection) => [selection.caseId, selection]));
      await Promise.all(
        definitions.map((definition) => {
          const selection = selectionByCase.get(definition.id)!;
          const snapshot = {
            title: definition.title,
            priority: definition.priority,
            precondition: definition.precondition,
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

  async completeScope(id: string, dto: CompleteTestScopeDto) {
    const request = await this.prisma.testRequest.findUnique({
      where: { id },
      include: {
        testPlan: { include: { _count: { select: { snapshots: true } } } },
        workflowLinks: { include: { workflowRun: { select: { status: true } } } },
      },
    });
    if (!request) {
      throw new NotFoundException('Test request not found.');
    }
    assertTestRequestTransition(request.status as TestRequestStatus, TestRequestStatus.READY);
    if (!request.testPlan?._count.snapshots) {
      throw new BadRequestException('At least one test case snapshot is required.');
    }
    if (request.workflowLinks.some((link) => link.workflowRun.status.toLowerCase() !== 'done')) {
      throw new BadRequestException('A linked development workflow is no longer completed.');
    }
    const failedChecks = dto.coverageChecks.filter((check) => !check.passed);
    if (failedChecks.length) {
      throw new BadRequestException({
        code: 'TEST_SCOPE_INCOMPLETE',
        message: 'Test scope coverage checks are incomplete.',
        failedChecks,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.testPlan.update({
        where: { id: request.testPlan!.id },
        data: { status: 'READY' },
      });
      return tx.testRequest.update({
        where: { id },
        data: {
          status: TestRequestStatus.READY,
          scopeGenerationStatus: 'COMPLETED',
          scopeSummary: dto.summary.trim(),
          scopeRevision: { increment: 1 },
          scopeChecks: dto.coverageChecks as unknown as Prisma.InputJsonValue,
          excludedScopes: dto.excludedScopes as Prisma.InputJsonValue,
        },
        include: requestInclude,
      });
    });
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
