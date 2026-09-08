import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  GenerateTestDesignInput,
  SpecPlanOutput,
  TestDesignCaseDraft,
  TestDesignGenerationOutput,
} from '../common/types';
import { AI_EXECUTOR, type AIExecutor } from '../ai/ai-executor';
import type {
  ConfirmTestDesignDto,
  CreateTestDesignDto,
  SmokeCaseDto,
  UpdateTestDesignCandidateDto,
  UpdateTestDesignSmokeDto,
} from './dto/test-design.dto';
import { PrismaService } from '../prisma/prisma.service';

const designInclude = {
  requirements: { include: { requirement: true } },
  workflowRuns: { include: { workflowRun: true } },
  candidates: {
    orderBy: { sortOrder: 'asc' as const },
    include: { sourceDefinition: { include: { library: true } } },
  },
  smokeCases: { orderBy: { sortOrder: 'asc' as const } },
  testRequest: true,
  testPlan: true,
} as const;

const comparisonCaseSelect = {
  id: true,
  version: true,
  title: true,
  priority: true,
  precondition: true,
  steps: true,
  expected: true,
  tags: true,
  library: { select: { scope: true, projectId: true, name: true } },
} as const;

@Injectable()
export class TestDesignsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_EXECUTOR) private readonly aiExecutor: AIExecutor,
  ) {}

  async createDesign(dto: CreateTestDesignDto) {
    const requirementIds = unique(dto.requirementIds);
    const workflowRunIds = unique(dto.workflowRunIds);
    if (!requirementIds.length || !workflowRunIds.length) {
      throw new BadRequestException('At least one requirement and workflow run are required.');
    }
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, workspaceId: dto.workspaceId, status: 'ACTIVE' },
    });
    if (!project) throw new BadRequestException('Project does not belong to the selected workspace.');
    const projectVersion = await this.prisma.projectVersion.findFirst({
      where: { id: dto.projectVersionId, projectId: dto.projectId },
    });
    if (!projectVersion) throw new BadRequestException('Project version does not belong to the selected project.');

    const requirements = await this.prisma.requirement.findMany({
      where: { id: { in: requirementIds }, projectId: dto.projectId, versionId: dto.projectVersionId, status: 'ACTIVE' },
      select: { id: true, title: true, description: true, acceptanceCriteria: true },
    });
    if (requirements.length !== requirementIds.length) {
      throw new BadRequestException('Some requirements do not belong to the selected project version.');
    }
    const workflows = await this.prisma.workflowRun.findMany({
      where: { id: { in: workflowRunIds }, requirementId: { in: requirementIds } },
      select: {
        id: true,
        status: true,
        requirementId: true,
        codeExecution: { select: { patchSummary: true } },
        stageExecutions: {
          where: { stage: { in: ['BRAINSTORM', 'DESIGN', 'SPEC_PLAN'] }, status: 'COMPLETED' },
          orderBy: { attempt: 'desc' },
          select: { stage: true, output: true, attempt: true },
        },
      },
    });
    const requiredStages = ['DESIGN', 'SPEC_PLAN'];
    if (
      workflows.length !== workflowRunIds.length
      || workflows.some((item) => requiredStages.some((stage) => !latestStageOutput(item.stageExecutions, stage)))
    ) {
      throw new BadRequestException({
        code: 'TEST_DESIGN_SOURCE_NOT_CONFIRMED',
        message: 'All linked workflows must have a requirement PRD plus confirmed design and Spec & Plan outputs.',
      });
    }
    const existingDesigns = await this.prisma.testDesign.findMany({
      where: {
        projectId: dto.projectId,
        projectVersionId: dto.projectVersionId,
        status: { notIn: ['STALE'] },
        testRequest: { is: null },
        workflowRuns: { some: { workflowRunId: { in: workflowRunIds } } },
      },
      include: designInclude,
      orderBy: { revision: 'desc' },
    });
    const existing = existingDesigns.find((item) => (
      sameIds(item.requirements.map((link) => link.requirementId), requirementIds)
      && sameIds(item.workflowRuns.map((link) => link.workflowRunId), workflowRunIds)
    ));
    if (existing) return existing;

    const orderedRequirements = requirementIds.map((id) => requirements.find((item) => item.id === id)!);
    const orderedWorkflows = workflowRunIds.map((id) => workflows.find((item) => item.id === id)!);
    const actualChangeSummary = orderedWorkflows
      .map((item) => item.codeExecution?.patchSummary)
      .filter(Boolean)
      .join('\n');
    const sourceSummary = {
      projectVersionId: dto.projectVersionId,
      requirementIds,
      workflowRunIds,
      changeSummary: actualChangeSummary || dto.changeSummary?.trim() || null,
      brainstorms: orderedWorkflows.map((item) => latestStageOutput(item.stageExecutions, 'BRAINSTORM')).filter(Boolean),
      designs: orderedWorkflows.map((item) => latestStageOutput(item.stageExecutions, 'DESIGN')).filter(Boolean),
      specPlans: orderedWorkflows.map((item) => latestStageOutput(item.stageExecutions, 'SPEC_PLAN')),
    };
    const sourceFingerprint = fingerprint({ requirements: orderedRequirements, sourceSummary });
    const latest = await this.prisma.testDesign.findFirst({
      where: { projectId: dto.projectId, projectVersionId: dto.projectVersionId },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    return this.prisma.testDesign.create({
      data: {
        workspaceId: dto.workspaceId,
        projectId: dto.projectId,
        projectVersionId: dto.projectVersionId,
        revision: (latest?.revision ?? 0) + 1,
        sourceFingerprint,
        sourceSummary: sourceSummary as Prisma.InputJsonValue,
        requirements: { create: requirementIds.map((requirementId) => ({ requirementId })) },
        workflowRuns: { create: workflowRunIds.map((workflowRunId) => ({ workflowRunId })) },
      },
      include: designInclude,
    });
  }

  getDesign(id: string) {
    return this.prisma.testDesign.findUnique({ where: { id }, include: designInclude }).then((design) => {
      if (!design) throw new NotFoundException('Test design not found.');
      return design;
    });
  }

  listDesigns(filters: { projectId?: string; projectVersionId?: string; status?: string }) {
    return this.prisma.testDesign.findMany({
      where: { projectId: filters.projectId, projectVersionId: filters.projectVersionId, status: filters.status },
      include: designInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async assertReadyForRequest(id: string) {
    const design = await this.getDesign(id);
    if (design.status !== 'CONFIRMED') {
      throw new BadRequestException({ code: 'TEST_REQUEST_DESIGN_REQUIRED', message: 'A confirmed test design is required before submitting for test.' });
    }
    if (design.testRequest) {
      throw new BadRequestException({ code: 'TEST_DESIGN_ALREADY_FROZEN', message: 'Test design is already linked to a test request.' });
    }
    await this.assertSourceFresh(design);
    return design;
  }

  async generate(id: string) {
    const design = await this.getDesign(id);
    if (design.status === 'GENERATING') {
      throw new BadRequestException('Test design generation is already in progress.');
    }
    if (design.testRequest) {
      throw new BadRequestException({
        code: 'TEST_DESIGN_ALREADY_FROZEN',
        message: 'Test design is already linked to a test request. Create a new revision instead.',
      });
    }
    const requirements = design.requirements.map((item) => item.requirement);
    const requirement = requirements[0];
    const refreshed = await this.loadCurrentSource(design);
    const sourceSummary = refreshed.sourceSummary;
    const stageOutput = Array.isArray(sourceSummary.specPlans) ? sourceSummary.specPlans[0] : null;
    if (!requirement || !stageOutput) throw new BadRequestException('Test design source is incomplete.');
    const [projectCases, workspaceCases] = await Promise.all([
      this.prisma.testCaseDefinition.findMany({
        where: { status: 'ACTIVE', library: { workspaceId: design.workspaceId, projectId: design.projectId } },
        select: comparisonCaseSelect,
        orderBy: { updatedAt: 'desc' },
        take: 250,
      }),
      this.prisma.testCaseDefinition.findMany({
        where: { status: 'ACTIVE', library: { workspaceId: design.workspaceId, projectId: null } },
        select: comparisonCaseSelect,
        orderBy: { updatedAt: 'desc' },
        take: 250,
      }),
    ]);
    const existingCases = [...projectCases, ...workspaceCases];
    const input: GenerateTestDesignInput = {
      requirement: {
        id: requirements.map((item) => item.id).join(','),
        title: requirements.map((item) => item.title).join(' / '),
        description: requirements.map((item) => item.description).join('\n\n'),
        acceptanceCriteria: requirements.map((item) => item.acceptanceCriteria).join('\n'),
      },
      brainstormContext: sourceSummary.brainstorms ?? null,
      designContext: sourceSummary.designs ?? null,
      specPlan: stageOutput as unknown as SpecPlanOutput,
      existingCases: existingCases.map(({ library, ...item }) => ({
        ...item,
        steps: readStringArray(item.steps),
        tags: readStringArray(item.tags),
        libraryScope: library.scope,
        libraryProjectId: library.projectId,
        libraryName: library.name,
      })),
      changeSummary: typeof sourceSummary.changeSummary === 'string' ? sourceSummary.changeSummary : null,
    };
    await this.prisma.testDesign.update({
      where: { id },
      data: {
        status: 'GENERATING',
        sourceFingerprint: refreshed.sourceFingerprint,
        sourceSummary: sourceSummary as Prisma.InputJsonValue,
        staleReason: null,
      },
    });
    let output: TestDesignGenerationOutput;
    try {
      output = await this.aiExecutor.generateTestDesign(input);
    } catch (error) {
      await this.prisma.testDesign.update({ where: { id }, data: { status: 'GENERATION_FAILED' } });
      throw error;
    }
    validateGeneratedOutput(output, new Set(existingCases.map((item) => item.id)));
    return this.prisma.$transaction(async (tx) => {
      await tx.testDesignCandidate.deleteMany({ where: { testDesignId: id } });
      await tx.testDesignSmokeCase.deleteMany({ where: { testDesignId: id } });
      await tx.testDesign.update({
        where: { id },
        data: {
          status: 'WAITING_REVIEW',
          revision: { increment: 1 },
          sourceSummary: { ...sourceSummary, aiSourceSummary: output.sourceSummary } as Prisma.InputJsonValue,
          coverageSummary: output.coverageSummary as Prisma.InputJsonValue,
          uncoveredItems: output.uncoveredItems as Prisma.InputJsonValue,
          staleReason: null,
          confirmedByUserId: null,
          confirmedAt: null,
        },
      });
      await tx.testDesignCandidate.createMany({
        data: output.candidates.map((candidate, index) => ({
          testDesignId: id,
          action: candidate.action,
          sourceDefinitionId: candidate.sourceDefinitionId ?? null,
          sourceVersion: candidate.sourceVersion ?? null,
          matchScore: candidate.matchScore ?? null,
          matchReason: candidate.matchReason ?? null,
          coverageKeys: candidate.coverageKeys as Prisma.InputJsonValue,
          proposedCase: candidate.proposedCase as unknown as Prisma.InputJsonValue,
          sortOrder: index,
        })),
      });
      await tx.testDesignSmokeCase.createMany({
        data: output.smokeCases.map((item, index) => ({
          testDesignId: id,
          title: item.title,
          priority: item.priority,
          precondition: item.precondition ?? null,
          steps: item.steps as Prisma.InputJsonValue,
          expected: item.expected,
          blocking: item.blocking,
          coverageKeys: item.coverageKeys as Prisma.InputJsonValue,
          sortOrder: index,
        })),
      });
      return tx.testDesign.findUnique({ where: { id }, include: designInclude });
    });
  }

  async updateCandidate(id: string, candidateId: string, dto: UpdateTestDesignCandidateDto) {
    const candidate = await this.prisma.testDesignCandidate.findUnique({ where: { id: candidateId }, include: { testDesign: true } });
    if (!candidate || candidate.testDesignId !== id) throw new NotFoundException('Test design candidate not found.');
    assertRevision(candidate.testDesign.revision, dto.revision);
    if (candidate.testDesign.status !== 'WAITING_REVIEW') {
      throw new BadRequestException('Test design is not editable.');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.testDesignCandidate.update({
        where: { id: candidateId },
        data: {
          action: dto.action,
          resolution: dto.resolution,
          matchScore: dto.matchScore,
          decisionNote: dto.decisionNote?.trim() || null,
          proposedCase: dto.proposedCase as unknown as Prisma.InputJsonValue | undefined,
        },
      });
      await tx.testDesign.update({ where: { id }, data: { revision: { increment: 1 } } });
      return updated;
    });
  }

  async updateSmoke(id: string, dto: UpdateTestDesignSmokeDto) {
    const design = await this.getDesign(id);
    assertRevision(design.revision, dto.revision);
    if (design.status !== 'WAITING_REVIEW') {
      throw new BadRequestException('Test design is not editable.');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.testDesignSmokeCase.deleteMany({ where: { testDesignId: id } });
      await tx.testDesignSmokeCase.createMany({
        data: dto.cases.map((item, index) => ({
          testDesignId: id,
          title: item.title.trim(),
          priority: item.priority ?? 'P1',
          precondition: item.precondition?.trim() || null,
          steps: item.steps as Prisma.InputJsonValue,
          expected: item.expected.trim(),
          blocking: item.blocking,
          coverageKeys: item.coverageKeys as Prisma.InputJsonValue,
          resolution: item.resolution,
          sortOrder: index,
        })),
      });
      return tx.testDesign.update({
        where: { id },
        data: { noSmokeReason: dto.noSmokeReason?.trim() || null, revision: { increment: 1 } },
        include: designInclude,
      });
    });
  }

  async confirm(id: string, dto: ConfirmTestDesignDto, userId?: string) {
    const design = await this.getDesign(id);
    assertRevision(design.revision, dto.revision);
    if (!['WAITING_REVIEW', 'WAITING_CONFIRMATION'].includes(design.status)) {
      throw new BadRequestException('Test design must be generated before confirmation.');
    }
    if (design.status === 'STALE') throw new BadRequestException({ code: 'TEST_DESIGN_SOURCE_STALE', message: 'Test design source is stale.' });
    if (design.candidates.some((candidate) => candidate.resolution === 'PENDING')) {
      throw new BadRequestException({ code: 'TEST_DESIGN_CANDIDATE_UNRESOLVED', message: 'All test design candidates must be resolved.' });
    }
    if (dto.coverageChecks.some((check) => !check.passed)) {
      throw new BadRequestException('All coverage checks must pass or be explicitly resolved before confirmation.');
    }
    await this.assertSourceFresh(design);
    const acceptedCases = design.candidates.filter((candidate) => candidate.resolution === 'ACCEPTED' && candidate.action !== 'EXCLUDE');
    if (!acceptedCases.length && !dto.noCaseReason?.trim()) {
      throw new BadRequestException('At least one functional case or a no-case reason is required.');
    }
    if (design.smokeCases.length && design.smokeCases.some((item) => item.resolution !== 'ACCEPTED')) {
      throw new BadRequestException({ code: 'TEST_DESIGN_SMOKE_UNCONFIRMED', message: 'All smoke cases must be confirmed.' });
    }
    if (!design.smokeCases.length && !dto.noSmokeReason?.trim()) {
      throw new BadRequestException('A no-smoke reason is required when no smoke case exists.');
    }
    const sourceIds = design.candidates.map((candidate) => candidate.sourceDefinitionId).filter((value): value is string => Boolean(value));
    const sources = await this.prisma.testCaseDefinition.findMany({ where: { id: { in: sourceIds }, status: 'ACTIVE' } });
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    for (const candidate of design.candidates.filter((item) => item.resolution === 'ACCEPTED' && ['REUSE', 'OPTIMIZE'].includes(item.action))) {
      const source = candidate.sourceDefinitionId ? sourceById.get(candidate.sourceDefinitionId) : null;
      if (!source || source.version !== candidate.sourceVersion) throw new BadRequestException({ code: 'TEST_DESIGN_SOURCE_CONFLICT', message: 'A source test case has changed. Refresh the comparison.' });
      if (candidate.action === 'REUSE' && stableStringify(normalizeCase(candidate.proposedCase)) !== stableStringify(normalizeCase(source))) {
        throw new BadRequestException({ code: 'TEST_DESIGN_REUSE_CHANGED', message: 'A reused case must match its source. Change the action to OPTIMIZE.' });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let projectLibrary = await tx.testCaseLibrary.findFirst({ where: { workspaceId: design.workspaceId, projectId: design.projectId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
      if (!projectLibrary && acceptedCases.some((item) => item.action === 'CREATE')) {
        projectLibrary = await tx.testCaseLibrary.create({ data: { workspaceId: design.workspaceId, projectId: design.projectId, scope: 'PROJECT', name: '自动生成用例' } });
      }
      for (const candidate of acceptedCases) {
        const proposed = normalizeCase(candidate.proposedCase);
        if (candidate.action === 'OPTIMIZE' && candidate.sourceDefinitionId) {
          const updated = await tx.testCaseDefinition.update({ where: { id: candidate.sourceDefinitionId }, data: { ...caseData(proposed), version: { increment: 1 } } });
          await tx.testDesignCandidate.update({ where: { id: candidate.id }, data: { sourceVersion: updated.version } });
        } else if (candidate.action === 'CREATE' && projectLibrary) {
          const created = await tx.testCaseDefinition.create({ data: { libraryId: projectLibrary.id, ...caseData(proposed) } });
          await tx.testDesignCandidate.update({ where: { id: candidate.id }, data: { sourceDefinitionId: created.id, sourceVersion: created.version } });
        }
      }
      return tx.testDesign.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          coverageChecks: dto.coverageChecks as unknown as Prisma.InputJsonValue,
          uncoveredItems: dto.uncoveredItems as Prisma.InputJsonValue,
          noCaseReason: dto.noCaseReason?.trim() || null,
          noSmokeReason: dto.noSmokeReason?.trim() || null,
          confirmedByUserId: userId ?? null,
          confirmedAt: new Date(),
        },
        include: designInclude,
      });
    });
  }

  private async assertSourceFresh(design: Awaited<ReturnType<TestDesignsService['getDesign']>>) {
    const current = await this.loadCurrentSource(design);
    if (current.sourceFingerprint !== design.sourceFingerprint) {
      await this.prisma.testDesign.update({ where: { id: design.id }, data: { status: 'STALE', staleReason: '上游产物或实际开发变更已发生变化' } });
      throw new BadRequestException({ code: 'TEST_DESIGN_SOURCE_STALE', message: 'Test design source has changed. Regenerate before confirmation.' });
    }
  }

  private async loadCurrentSource(design: Awaited<ReturnType<TestDesignsService['getDesign']>>) {
    const source = asRecord(design.sourceSummary);
    const requirementIds = readStringArray(source.requirementIds);
    const workflowRunIds = readStringArray(source.workflowRunIds);
    const requirements = await this.prisma.requirement.findMany({
      where: { id: { in: requirementIds } },
      select: { id: true, title: true, description: true, acceptanceCriteria: true },
    });
    const workflows = await this.prisma.workflowRun.findMany({
      where: { id: { in: workflowRunIds } },
      select: {
        id: true,
        codeExecution: { select: { patchSummary: true } },
        stageExecutions: {
          where: { stage: { in: ['BRAINSTORM', 'DESIGN', 'SPEC_PLAN'] }, status: 'COMPLETED' },
          orderBy: { attempt: 'desc' },
          select: { stage: true, output: true, attempt: true },
        },
      },
    });
    const orderedWorkflows = workflowRunIds.map((id) => workflows.find((item) => item.id === id)).filter(Boolean);
    const currentSummary = {
      projectVersionId: design.projectVersionId,
      requirementIds,
      workflowRunIds,
      changeSummary: orderedWorkflows.map((item) => item!.codeExecution?.patchSummary).filter(Boolean).join('\n') || source.changeSummary || null,
      brainstorms: orderedWorkflows.map((item) => latestStageOutput(item!.stageExecutions, 'BRAINSTORM')).filter(Boolean),
      designs: orderedWorkflows.map((item) => latestStageOutput(item!.stageExecutions, 'DESIGN')).filter(Boolean),
      specPlans: orderedWorkflows.map((item) => latestStageOutput(item!.stageExecutions, 'SPEC_PLAN')),
    };
    const orderedRequirements = requirementIds.map((id) => requirements.find((item) => item.id === id)).filter(Boolean);
    return {
      sourceSummary: currentSummary,
      sourceFingerprint: fingerprint({ requirements: orderedRequirements, sourceSummary: currentSummary }),
    };
  }
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeCase(value: unknown): TestDesignCaseDraft {
  const item = asRecord(value);
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const expected = typeof item.expected === 'string' ? item.expected.trim() : '';
  const steps = readStringArray(item.steps).map((step) => step.trim()).filter(Boolean);
  if (!title || !expected || !steps.length) throw new BadRequestException('Every accepted test case must have title, steps and expected result.');
  return {
    title,
    priority: typeof item.priority === 'string' && item.priority ? item.priority : 'P2',
    precondition: typeof item.precondition === 'string' ? item.precondition.trim() || null : null,
    steps,
    expected,
    tags: readStringArray(item.tags),
  };
}

function caseData(value: TestDesignCaseDraft) {
  return {
    title: value.title,
    priority: value.priority,
    precondition: value.precondition ?? null,
    steps: value.steps as Prisma.InputJsonValue,
    expected: value.expected,
    tags: value.tags as Prisma.InputJsonValue,
  };
}

function assertRevision(current: number, requested: number) {
  if (current !== requested) throw new BadRequestException({ code: 'TEST_DESIGN_REVISION_CONFLICT', message: 'Test design revision is out of date.' });
}

function validateGeneratedOutput(output: TestDesignGenerationOutput, sourceIds: Set<string>) {
  if (!output || !Array.isArray(output.candidates) || !Array.isArray(output.smokeCases) || !Array.isArray(output.uncoveredItems)) {
    throw new BadRequestException({ code: 'TEST_DESIGN_GENERATION_INVALID', message: 'Generated test design output is invalid.' });
  }
  const referencedSourceIds = new Set<string>();
  for (const candidate of output.candidates) {
    if (candidate.sourceDefinitionId && !sourceIds.has(candidate.sourceDefinitionId)) {
      throw new BadRequestException({ code: 'TEST_DESIGN_GENERATION_INVALID', message: 'Generated source case is outside the comparison scope.' });
    }
    if (!['REUSE', 'OPTIMIZE', 'CREATE', 'EXCLUDE'].includes(candidate.action)) {
      throw new BadRequestException({ code: 'TEST_DESIGN_GENERATION_INVALID', message: 'Generated candidate action is invalid.' });
    }
    if (
      ['REUSE', 'OPTIMIZE'].includes(candidate.action)
      && (!candidate.sourceDefinitionId || !Number.isInteger(candidate.sourceVersion))
    ) {
      throw new BadRequestException({ code: 'TEST_DESIGN_GENERATION_INVALID', message: 'Reuse and optimization candidates require a source case and version.' });
    }
    if (candidate.action === 'CREATE' && candidate.sourceDefinitionId) {
      throw new BadRequestException({ code: 'TEST_DESIGN_GENERATION_INVALID', message: 'Created candidates cannot reference a source case.' });
    }
    if (candidate.sourceDefinitionId) {
      if (referencedSourceIds.has(candidate.sourceDefinitionId)) {
        throw new BadRequestException({ code: 'TEST_DESIGN_GENERATION_INVALID', message: 'A source case can appear in only one candidate.' });
      }
      referencedSourceIds.add(candidate.sourceDefinitionId);
    }
    normalizeCase(candidate.proposedCase);
  }
  for (const smokeCase of output.smokeCases) {
    if (!smokeCase.title?.trim() || !smokeCase.expected?.trim() || !readStringArray(smokeCase.steps).some((step) => step.trim())) {
      throw new BadRequestException({ code: 'TEST_DESIGN_GENERATION_INVALID', message: 'Every smoke case requires title, steps and expected result.' });
    }
  }
}

function latestStageOutput(
  stages: Array<{ stage: string; output: Prisma.JsonValue | null; attempt: number }>,
  stage: string,
) {
  return stages.filter((item) => item.stage === stage).sort((left, right) => right.attempt - left.attempt)[0]?.output ?? null;
}
