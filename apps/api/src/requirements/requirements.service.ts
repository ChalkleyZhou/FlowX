import { effectiveRequirementDescription } from './requirement-change-context';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AI_EXECUTOR_REGISTRY,
  type AIExecutor,
  type AIExecutorRegistry,
} from '../ai/ai-executor';
import {
  AiInvocationContextService,
  type AiInvocationRecipient,
} from '../ai/ai-invocation-context.service';
import { assertStrictGenerateDesignOutput } from '../ai/design-output-validate';
import { MockAiExecutor } from '../ai/mock-ai.executor';
import { IdeationSessionStatus, IdeationStatus, RequirementPriority } from '../common/enums';
import {
  BrainstormBrief,
  BrainstormOutput,
  DesignSpec,
  GenerateDesignOutput,
  RepositoryComponentContext,
} from '../common/types';
import { LocalDevPreviewService } from '../dev-preview/local-dev-preview.service';
import { PrototypeArchive } from '../prototype-imports/prototype-archive';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import { RepositorySyncService } from '../workspaces/repository-sync.service';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { toRequirementAssignmentResponse } from './requirement-assignment.mapper';
import { resolveRequirementVersionId } from './resolve-requirement-version';
import {
  IdeationSessionEventsRepository,
} from './ideation-session-events.repository';

const ideationStatusMap: Record<IdeationStatus, string> = {
  [IdeationStatus.NONE]: 'NONE',
  [IdeationStatus.BRAINSTORM_PENDING]: 'BRAINSTORM_PENDING',
  [IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION]: 'BRAINSTORM_WAITING_CONFIRMATION',
  [IdeationStatus.BRAINSTORM_CONFIRMED]: 'BRAINSTORM_CONFIRMED',
  [IdeationStatus.DESIGN_PENDING]: 'DESIGN_PENDING',
  [IdeationStatus.DESIGN_WAITING_CONFIRMATION]: 'DESIGN_WAITING_CONFIRMATION',
  [IdeationStatus.DESIGN_CONFIRMED]: 'DESIGN_CONFIRMED',
  [IdeationStatus.FINALIZED]: 'FINALIZED',
};

const ideationSessionStatusMap: Record<IdeationSessionStatus, string> = {
  [IdeationSessionStatus.PENDING]: 'PENDING',
  [IdeationSessionStatus.RUNNING]: 'RUNNING',
  [IdeationSessionStatus.COMPLETED]: 'COMPLETED',
  [IdeationSessionStatus.FAILED]: 'FAILED',
  [IdeationSessionStatus.WAITING_CONFIRMATION]: 'WAITING_CONFIRMATION',
};

type IdeationAuthSession = {
  user: {
    id: string;
    displayName: string;
  };
  organization?: {
    id?: string | null;
    providerOrganizationId?: string | null;
    name?: string | null;
  } | null;
};

@Injectable()
export class RequirementsService {
  private readonly logger = new Logger(RequirementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_EXECUTOR_REGISTRY) private readonly executorRegistry: AIExecutorRegistry,
    private readonly aiInvocationContextService: AiInvocationContextService,
    private readonly localDevPreviewService: LocalDevPreviewService,
    private readonly ideationSessionEventsRepository: IdeationSessionEventsRepository,
    private readonly repositorySyncService: RepositorySyncService,
    // Pick 等类型别名会被装饰器元数据记成 Object，Nest 无法注入，必须显式指定 WorkflowService。
    @Inject(WorkflowService) private readonly workflowService: WorkflowService,
  ) {}

  async create(dto: CreateRequirementDto, author?: { user: { id: string; displayName: string } }) {
    const title = dto.title.trim();
    if (!title) {
      throw new BadRequestException('请填写需求标题');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: {
        workspace: {
          include: {
            repositories: {
              where: { status: 'ACTIVE' },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const requestedRepositoryIds = Array.from(
      new Set((dto.repositoryIds ?? []).map((value) => value.trim()).filter(Boolean)),
    );
    const allowedRepositoryIds = new Set(
      project.workspace.repositories.map((repository) => repository.id),
    );
    const invalidRepositoryIds = requestedRepositoryIds.filter(
      (repositoryId) => !allowedRepositoryIds.has(repositoryId),
    );

    if (invalidRepositoryIds.length > 0) {
      throw new NotFoundException('One or more selected repositories do not belong to the project workspace.');
    }

    const versionId = await resolveRequirementVersionId({
      ...(Object.prototype.hasOwnProperty.call(dto, 'versionId') ? { versionId: dto.versionId } : {}),
      currentVersionId: project.currentVersionId,
      assertOwned: async (id) => {
        await this.assertVersionOwned(dto.projectId, id);
      },
    });

    if (!versionId) {
      throw new BadRequestException('请选择发布版本；项目没有当前版本时，请先在项目中设置');
    }

    return this.prisma.requirement.create({
      data: {
        projectId: dto.projectId,
        title,
        description: dto.description?.trim() ?? '',
        acceptanceCriteria: dto.acceptanceCriteria?.trim() ?? '',
        functionalModule: dto.functionalModule?.trim() ?? '',
        riskImpact: dto.riskImpact?.trim() ?? '',
        productRequirementDocument: dto.productRequirementDocument?.trim() ?? '',
        remark: dto.remark?.trim() ?? '',
        priority: dto.priority ?? RequirementPriority.MEDIUM,
        workspaceId: project.workspaceId,
        versionId,
        ...(author?.user.id
          ? { createdByUserId: author.user.id, createdByName: author.user.displayName }
          : {}),
        requirementRepositories:
          requestedRepositoryIds.length > 0
            ? {
                create: requestedRepositoryIds.map((repositoryId) => ({
                  repositoryId,
                })),
              }
            : undefined,
      },
      include: {
        project: {
          include: {
            workspace: {
              include: {
                repositories: {
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
        workspace: true,
        requirementRepositories: {
          include: {
            repository: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        version: { select: { id: true, name: true } },
      },
    });
  }

  private readonly requirementRelationsInclude = {
    version: { select: { id: true, name: true } },
    assignments: {
      include: { user: true },
      orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    },
  };

  private enrichRequirement<T extends { assignments?: Array<Parameters<typeof toRequirementAssignmentResponse>[0]> }>(
    requirement: T,
  ) {
    if (!requirement.assignments) {
      return requirement;
    }
    return {
      ...requirement,
      assignments: requirement.assignments.map((row) => toRequirementAssignmentResponse(row)),
    };
  }

  async update(id: string, dto: UpdateRequirementDto) {
    const existing = await this.findOne(id);
    if (Object.prototype.hasOwnProperty.call(dto, 'versionId') && dto.versionId) {
      await this.assertVersionOwned(existing.project.id, dto.versionId);
    }
    const title = dto.title?.trim();
    if (dto.title !== undefined && !title) {
      throw new BadRequestException('请填写需求名称');
    }
    const text = (value: string) => value.trim();
    const updated = await this.prisma.requirement.update({
      where: { id },
      data: {
        ...(title ? { title } : {}),
        ...(dto.description !== undefined ? { description: text(dto.description) } : {}),
        ...(dto.acceptanceCriteria !== undefined ? { acceptanceCriteria: text(dto.acceptanceCriteria) } : {}),
        ...(dto.functionalModule !== undefined ? { functionalModule: text(dto.functionalModule) } : {}),
        ...(dto.riskImpact !== undefined ? { riskImpact: text(dto.riskImpact) } : {}),
        ...(dto.productRequirementDocument !== undefined ? { productRequirementDocument: text(dto.productRequirementDocument) } : {}),
        ...(dto.remark !== undefined ? { remark: text(dto.remark) } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.planningStatus !== undefined ? { planningStatus: dto.planningStatus } : {}),
        ...(Object.prototype.hasOwnProperty.call(dto, 'versionId') ? { versionId: dto.versionId ?? null } : {}),
      },
      include: {
        project: {
          include: {
            workspace: {
              include: {
                repositories: {
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
        workspace: true,
        requirementRepositories: {
          include: { repository: true },
          orderBy: { createdAt: 'asc' },
        },
        ...this.requirementRelationsInclude,
      },
    });
    return this.enrichRequirement(updated);
  }

  async remove(id: string) {
    const requirement = await this.prisma.requirement.findUnique({
      where: { id },
      select: {
        id: true,
        prototypeImport: { select: { id: true, materialRevision: true } },
        changes: { select: { prototype: true } },
        workflowRuns: {
          select: {
            id: true,
            stageExecutions: { select: { status: true } },
          },
        },
      },
    });
    if (!requirement) {
      throw new NotFoundException('需求不存在。');
    }

    if (requirement.workflowRuns.some((workflow) => workflow.stageExecutions.some((stage) => stage.status === 'RUNNING'))) {
      throw new BadRequestException('当前需求仍有工作流阶段在执行中，请等待完成后再删除。');
    }

    const workflowIds = requirement.workflowRuns.map((workflow) => workflow.id);
    const [testDesignCount, testRequestCount, designWorkflowCount, requestWorkflowCount] = await Promise.all([
      this.prisma.testDesignRequirement.count({ where: { requirementId: id } }),
      this.prisma.testRequestRequirement.count({ where: { requirementId: id } }),
      workflowIds.length === 0
        ? Promise.resolve(0)
        : this.prisma.testDesignWorkflowRun.count({ where: { workflowRunId: { in: workflowIds } } }),
      workflowIds.length === 0
        ? Promise.resolve(0)
        : this.prisma.testRequestWorkflowRun.count({ where: { workflowRunId: { in: workflowIds } } }),
    ]);
    if (testDesignCount > 0 || testRequestCount > 0 || designWorkflowCount > 0 || requestWorkflowCount > 0) {
      throw new ConflictException('该需求或它的工作流已关联测试设计或提测，请先解除关联后再删除。');
    }

    // 修复工作流外键没有级联，必须先解开，工作流删除才能成功。
    if (workflowIds.length > 0) {
      await this.prisma.bug.updateMany({
        where: { fixWorkflowRunId: { in: workflowIds } },
        data: { fixWorkflowRunId: null },
      });
    }
    for (const workflowId of workflowIds) {
      await this.workflowService.deleteWorkflowRun(workflowId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.issue.updateMany({ where: { requirementId: id }, data: { requirementId: null } });
      await tx.bug.updateMany({ where: { requirementId: id }, data: { requirementId: null } });
      await tx.bug.updateMany({ where: { fixRequirementId: id }, data: { fixRequirementId: null } });
      await tx.requirementRepository.deleteMany({ where: { requirementId: id } });
      await tx.requirement.delete({ where: { id } });
    });
    await this.removePrototypeFiles(requirement);

    return { success: true };
  }

  private async removePrototypeFiles(requirement: {
    prototypeImport: { id: string; materialRevision: number } | null;
    changes: Array<{ prototype: unknown }>;
  }) {
    const archive = new PrototypeArchive();
    const revisions = requirement.prototypeImport
      ? Array.from({ length: Math.max(requirement.prototypeImport.materialRevision, 1) }, (_, index) => index + 1)
      : [];
    const jobs = [
      ...revisions.map((revision) => archive.remove(requirement.prototypeImport!.id, revision)),
      ...requirement.changes.flatMap((change) => {
        const archiveId = this.prototypeArchiveId(change.prototype);
        return archiveId ? [archive.remove(archiveId, 1)] : [];
      }),
    ];
    await Promise.all(jobs.map(async (job) => {
      try {
        await job;
      } catch (error) {
        this.logger.warn(`删除需求原型材料失败: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }));
  }

  private prototypeArchiveId(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const archiveId = (value as { archiveId?: unknown }).archiveId;
    return typeof archiveId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(archiveId) ? archiveId : null;
  }

  async findAll() {
    const rows = await this.prisma.requirement.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        ...this.requirementRelationsInclude,
        prototypeImport: { select: { id: true, status: true } },
        project: {
          include: {
            workspace: {
              include: {
                repositories: {
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
        workspace: {
          include: {
            repositories: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        workflowRuns: {
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            workflowRepositories: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
        requirementRepositories: {
          include: {
            repository: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        changes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    return rows.map((row) => {
      const { changes, ...rest } = row;
      return {
        ...this.enrichRequirement(rest),
        latestChangeAt: changes[0]?.createdAt ?? null,
      };
    });
  }

  async findOne(id: string) {
    const requirement = await this.prisma.requirement.findUniqueOrThrow({
      where: { id },
      include: {
        changes: { orderBy: { revision: 'asc' } },
        project: {
          include: {
            workspace: {
              include: {
                repositories: {
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
        workspace: {
          include: {
            repositories: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        workflowRuns: {
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            workflowRepositories: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
        requirementRepositories: {
          include: {
            repository: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        prototypeImport: { select: { id: true, status: true } },
        ideationSessions: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        ideationArtifacts: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        ...this.requirementRelationsInclude,
      },
    });
    return this.enrichRequirement(requirement);
  }

  private async assertVersionOwned(projectId: string, versionId: string) {
    const owned = await this.prisma.projectVersion.findFirst({ where: { id: versionId, projectId } });
    if (!owned) {
      throw new BadRequestException('Version does not belong to this project.');
    }
  }

  // ── Ideation methods ──

  async startBrainstorm(requirementId: string, hint?: string, authSession?: IdeationAuthSession) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.NONE && currentStatus !== IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot start brainstorm from status ${currentStatus}. Expected NONE or BRAINSTORM_WAITING_CONFIRMATION.`,
      );
    }

    const previousBriefs = await this.getPreviousBriefs(requirementId);
    const previousAttemptCount = previousBriefs.length;
    const executor = this.resolveIdeationExecutor();
    const session = await this.prisma.ideationSession.create({
      data: {
        requirementId,
        stage: 'BRAINSTORM',
        attempt: previousAttemptCount + 1,
        status: ideationSessionStatusMap[IdeationSessionStatus.RUNNING],
        input: { requirementRevision: requirement.revision ?? 0, requirementTitle: requirement.title, requirementDescription: effectiveRequirementDescription(requirement), humanHint: hint },
        startedAt: new Date(),
      },
    });

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_PENDING] },
    });

    this.runIdeationInBackground(`brainstorm:${session.id}`, async () => {
    try {
      const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
        undefined,
        this.toAiInvocationRecipient(authSession),
      );
      const result = await executor.brainstorm(
        {
          requirementTitle: requirement.title,
          requirementDescription: effectiveRequirementDescription(requirement),
          previousBriefs: previousBriefs.length > 0 ? previousBriefs : undefined,
          humanFeedback: hint || undefined,
          workspaceContext: requirement.workspace?.name || undefined,
        },
        invocationContext,
      );
      const normalizedResult = this.normalizeBrainstormOutput(result);

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
          output: normalizedResult as any,
          finishedAt: new Date(),
          statusMessage: 'Brainstorm completed, waiting for confirmation.',
        },
      });
      await this.markSupersededWaitingSessions(requirementId, 'BRAINSTORM', session.id);

      await this.prisma.requirement.update({
        where: { id: requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION] },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown brainstorm error';
      this.logger.error(`Brainstorm failed for requirement ${requirementId}: ${message}`);

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.FAILED],
          errorMessage: message,
          finishedAt: new Date(),
        },
      });

      await this.prisma.requirement.update({
        where: { id: requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.NONE] },
      });
    }
    });

    return this.findOne(requirementId);
  }

  async reviseBrainstorm(requirementId: string, feedback: string, authSession?: IdeationAuthSession) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot revise brainstorm from status ${currentStatus}. Expected BRAINSTORM_WAITING_CONFIRMATION.`,
      );
    }

    const executor = this.resolveIdeationExecutor();
    const previousBriefs = await this.getPreviousBriefs(requirementId);
    const session = await this.prisma.ideationSession.create({
      data: {
        requirementId,
        stage: 'BRAINSTORM',
        attempt: previousBriefs.length + 1,
        status: ideationSessionStatusMap[IdeationSessionStatus.RUNNING],
        input: { requirementRevision: requirement.revision ?? 0, feedback },
        startedAt: new Date(),
      },
    });

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_PENDING] },
    });

    this.runIdeationInBackground(`brainstorm-revise:${session.id}`, async () => {
    try {
      const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
        undefined,
        this.toAiInvocationRecipient(authSession),
      );
      const result = await executor.brainstorm(
        {
          requirementTitle: requirement.title,
          requirementDescription: effectiveRequirementDescription(requirement),
          previousBriefs,
          humanFeedback: feedback,
          workspaceContext: requirement.workspace?.name || undefined,
        },
        invocationContext,
      );
      const normalizedResult = this.normalizeBrainstormOutput(result);

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
          output: normalizedResult as any,
          finishedAt: new Date(),
          statusMessage: 'Brainstorm revised, waiting for confirmation.',
        },
      });
      await this.markSupersededWaitingSessions(requirementId, 'BRAINSTORM', session.id);

      await this.prisma.requirement.update({
        where: { id: requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION] },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown brainstorm revision error';
      this.logger.error(`Brainstorm revision failed for requirement ${requirementId}: ${message}`);

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.FAILED],
          errorMessage: message,
          finishedAt: new Date(),
        },
      });

      await this.prisma.requirement.update({
        where: { id: requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION] },
      });
    }
    });

    return this.findOne(requirementId);
  }

  async confirmBrainstorm(requirementId: string) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot confirm brainstorm from status ${currentStatus}. Expected BRAINSTORM_WAITING_CONFIRMATION.`,
      );
    }

    const brainstormSessions = (requirement.ideationSessions ?? [])
      .filter((session: { stage: string }) => session.stage === 'BRAINSTORM')
      .sort((a: { attempt: number }, b: { attempt: number }) => b.attempt - a.attempt);
    const waitingSessionWithBrief = brainstormSessions.find((session: { status?: string; output?: unknown }) => {
      if (session.status !== ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION]) {
        return false;
      }
      return Boolean(this.extractBrainstormBrief(session.output));
    });
    const lastSession = waitingSessionWithBrief
      ?? brainstormSessions.find((session: { output?: unknown }) => Boolean(this.extractBrainstormBrief(session.output)));
    const brief = this.extractBrainstormBrief(lastSession?.output);
    if (!lastSession || !brief) {
      throw new BadRequestException('当前轮次没有可确认的产品简报，请重新生成后再确认。');
    }

    await this.prisma.ideationArtifact.create({
      data: {
        requirementId,
        type: 'BRAINSTORM_BRIEF',
        content: brief as any,
      },
    });

    await this.prisma.ideationSession.update({
      where: { id: lastSession.id },
      data: {
        status: ideationSessionStatusMap[IdeationSessionStatus.COMPLETED],
        statusMessage: 'Confirmed by user.',
      },
    });
    await this.markSupersededWaitingSessions(requirementId, 'BRAINSTORM', lastSession.id);

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_CONFIRMED] },
    });

    return this.findOne(requirementId);
  }

  async startDesign(requirementId: string, hint?: string, authSession?: IdeationAuthSession) {
    let requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.BRAINSTORM_CONFIRMED && currentStatus !== IdeationStatus.DESIGN_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot start design from status ${currentStatus}. Expected BRAINSTORM_CONFIRMED or DESIGN_WAITING_CONFIRMATION.`,
      );
    }

    const confirmedBrief = await this.getConfirmedBrief(requirementId);
    if (!confirmedBrief) {
      throw new BadRequestException('No confirmed brainstorm brief found. Confirm brainstorm first.');
    }
    requirement = await this.ensureIdeationRepositoriesReady(requirement);

    const previousDesigns = await this.getPreviousDesigns(requirementId);
    const executor = this.resolveIdeationExecutor();
    const session = await this.prisma.ideationSession.create({
      data: {
        requirementId,
        stage: 'DESIGN',
        attempt: previousDesigns.length + 1,
        status: ideationSessionStatusMap[IdeationSessionStatus.RUNNING],
        input: { requirementRevision: requirement.revision ?? 0, humanHint: hint },
        startedAt: new Date(),
      },
    });

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_PENDING] },
    });

    this.runIdeationInBackground(`design:${session.id}`, async () => {
    try {
      const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
        undefined,
        this.toAiInvocationRecipient(authSession),
      );
      const readyRepos = this.resolveReadyRepositories(requirement);
      this.logger.log(
        `Ideation design start requirement=${requirementId} session=${session.id} executor=${executor.constructor?.name ?? 'unknown'} readyRepoCount=${readyRepos.length}${readyRepos[0] ? ` primaryRepo=${readyRepos[0].id}` : ''}`,
      );

      const rawResult = await executor.generateDesign(
        {
          requirementTitle: requirement.title,
          requirementDescription: effectiveRequirementDescription(requirement),
          confirmedBrief,
          previousDesigns: previousDesigns.length > 0 ? previousDesigns : undefined,
          humanFeedback: hint || undefined,
          repositoryComponentContext: undefined,
        },
        invocationContext,
      );
      const result = this.normalizeDesignOutput(rawResult);
      this.logger.log(
        `Ideation design AI returned requirement=${requirementId} session=${session.id} overviewLen=${result.design.overview?.length ?? 0}`,
      );
      const designOnlyOutput = { design: result.design };
      const statusMessage = 'Design generation completed, waiting for confirmation.';

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
          output: designOnlyOutput as any,
          finishedAt: new Date(),
          statusMessage,
        },
      });
      await this.markSupersededWaitingSessions(requirementId, 'DESIGN', session.id);
      await this.closeStaleBrainstormWaitingSessions(requirementId);

      await this.prisma.requirement.update({
        where: { id: requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_WAITING_CONFIRMATION] },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown design generation error';
      this.logger.error(`Design generation failed for requirement ${requirementId}: ${message}`);

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.FAILED],
          errorMessage: message,
          finishedAt: new Date(),
        },
      });

      await this.prisma.requirement.update({
        where: { id: requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_CONFIRMED] },
      });
    }
    });

    return this.findOne(requirementId);
  }

  async reviseDesign(requirementId: string, feedback: string, authSession?: IdeationAuthSession) {
    let requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.DESIGN_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot revise design from status ${currentStatus}. Expected DESIGN_WAITING_CONFIRMATION.`,
      );
    }

    const confirmedBrief = await this.getConfirmedBrief(requirementId);
    if (!confirmedBrief) {
      throw new BadRequestException('No confirmed brainstorm brief found.');
    }
    requirement = await this.ensureIdeationRepositoriesReady(requirement);

    const previousDesigns = await this.getPreviousDesigns(requirementId);
    const latestDesignSessionWithOutput = requirement.ideationSessions
      ?.filter((session) => session.stage === 'DESIGN' && !!session.output)
      .sort((a, b) => b.attempt - a.attempt)[0];
    const previousLatestDesign = this.extractDesignSpecFromSessionOutput(
      latestDesignSessionWithOutput?.output,
    );
    const executor = this.resolveIdeationExecutor();
    const session = await this.prisma.ideationSession.create({
      data: {
        requirementId,
        stage: 'DESIGN',
        attempt: previousDesigns.length + 1,
        status: ideationSessionStatusMap[IdeationSessionStatus.RUNNING],
        input: { requirementRevision: requirement.revision ?? 0, feedback },
        startedAt: new Date(),
      },
    });

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_PENDING] },
    });

    this.runIdeationInBackground(`design-revise:${session.id}`, async () => {
    try {
      const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
        undefined,
        this.toAiInvocationRecipient(authSession),
      );
      const readyRepos = this.resolveReadyRepositories(requirement);
      this.logger.log(
        `Ideation design revise start requirement=${requirementId} session=${session.id} executor=${executor.constructor?.name ?? 'unknown'} readyRepoCount=${readyRepos.length}${readyRepos[0] ? ` primaryRepo=${readyRepos[0].id}` : ''}`,
      );

      const rawResult = await executor.generateDesign(
        {
          requirementTitle: requirement.title,
          requirementDescription: effectiveRequirementDescription(requirement),
          confirmedBrief,
          previousDesigns,
          humanFeedback: feedback,
          repositoryComponentContext: undefined,
        },
        invocationContext,
      );
      let result = this.normalizeDesignOutput(rawResult);

      if (previousLatestDesign && this.isSameDesignSpec(result.design, previousLatestDesign)) {
        const retryRawResult = await executor.generateDesign(
          {
            requirementTitle: requirement.title,
            requirementDescription: effectiveRequirementDescription(requirement),
            confirmedBrief,
            previousDesigns,
            humanFeedback: `${feedback}\n\n请确保本次修订与上一版有明确可见差异：至少调整 2 个页面的布局、关键组件或交互说明，并在 designRationale 开头总结本次具体变更点。`,
            repositoryComponentContext: undefined,
          },
          invocationContext,
        );
        result = this.normalizeDesignOutput(retryRawResult);
      }

      if (previousLatestDesign && this.isSameDesignSpec(result.design, previousLatestDesign)) {
        throw new Error(
          'DESIGN_REVISION_UNCHANGED: Regenerated result is identical to previous design. Please provide more specific feedback.',
        );
      }
      this.logger.log(
        `Ideation design revise final requirement=${requirementId} session=${session.id} overviewLen=${result.design.overview?.length ?? 0}`,
      );

      const statusMessage = 'Design revised, waiting for confirmation.';
      const designOnlyOutput = { design: result.design };

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
          output: designOnlyOutput as any,
          finishedAt: new Date(),
          statusMessage,
        },
      });
      await this.markSupersededWaitingSessions(requirementId, 'DESIGN', session.id);
      await this.closeStaleBrainstormWaitingSessions(requirementId);

      await this.prisma.requirement.update({
        where: { id: requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_WAITING_CONFIRMATION] },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown design revision error';
      this.logger.error(`Design revision failed for requirement ${requirementId}: ${message}`);

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.FAILED],
          errorMessage: message,
          finishedAt: new Date(),
        },
      });

      await this.prisma.requirement.update({
        where: { id: requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_WAITING_CONFIRMATION] },
      });
    }
    });

    return this.findOne(requirementId);
  }

  async confirmDesign(requirementId: string) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.DESIGN_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot confirm design from status ${currentStatus}. Expected DESIGN_WAITING_CONFIRMATION.`,
      );
    }

    const lastSession = requirement.ideationSessions
      ?.filter((s: { stage: string }) => s.stage === 'DESIGN')
      .sort((a: { attempt: number }, b: { attempt: number }) => b.attempt - a.attempt)[0];

    if (lastSession?.output) {
      const output = lastSession.output as { design?: DesignSpec };
      if (output.design) {
        await this.prisma.ideationArtifact.create({
          data: {
            requirementId,
            type: 'DESIGN_SPEC',
            content: output.design as any,
          },
        });
      }

      await this.prisma.ideationSession.update({
        where: { id: lastSession.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.COMPLETED],
          statusMessage: 'Confirmed by user.',
        },
      });
      await this.markSupersededWaitingSessions(requirementId, 'DESIGN', lastSession.id);
    }

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_CONFIRMED] },
    });

    return this.findOne(requirementId);
  }

  async getIdeationSessionEvents(requirementId: string, sessionId: string) {
    const session = await this.prisma.ideationSession.findFirst({
      where: { id: sessionId, requirementId },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException('Ideation session not found for this requirement.');
    }
    return this.ideationSessionEventsRepository.list(sessionId);
  }

  async finalizeIdeation(requirementId: string) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.DESIGN_CONFIRMED) {
      throw new BadRequestException(
        `Cannot finalize ideation from status ${currentStatus}. Expected DESIGN_CONFIRMED.`,
      );
    }

    const confirmedBrief = await this.getConfirmedBrief(requirementId);

    // Enrich the requirement with brainstorm content
    const updateData: { description?: string; acceptanceCriteria?: string; ideationStatus: string } = {
      ideationStatus: ideationStatusMap[IdeationStatus.FINALIZED],
    };

    if (confirmedBrief) {
      const enrichedDescription = [
        requirement.description,
        '',
        '--- 产品简报 ---',
        confirmedBrief.expandedDescription,
        '',
        '用户故事:',
        ...confirmedBrief.userStories.map(
          (story: { role: string; action: string; benefit: string }) =>
            `- 作为${story.role}，我希望${story.action}，以便${story.benefit}`,
        ),
      ].join('\n');

      const enrichedCriteria = [
        requirement.acceptanceCriteria,
        '',
        '--- 成功指标 ---',
        ...confirmedBrief.successMetrics.map((metric: string) => `- ${metric}`),
      ].join('\n');

      updateData.description = enrichedDescription;
      updateData.acceptanceCriteria = enrichedCriteria;
    }

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: updateData,
    });

    return this.findOne(requirementId);
  }

  // ── Ideation helpers ──

  private resolveIdeationExecutor(): AIExecutor {
    return this.executorRegistry.get(this.aiInvocationContextService.normalizeAiProvider(undefined));
  }

  private runIdeationInBackground(taskName: string, job: () => Promise<void>) {
    setTimeout(() => {
      void job().catch((error) => {
        this.logger.error(`${taskName} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 0);
  }

  private toAiInvocationRecipient(session?: IdeationAuthSession): AiInvocationRecipient | null {
    if (!session?.user?.id) {
      return null;
    }

    const rawOrgId = session.organization?.id;
    const orgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : '';

    return {
      flowxUserId: session.user.id,
      flowxOrganizationId: orgId.length > 0 ? orgId : null,
      displayName: session.user.displayName,
      providerOrganizationId: session.organization?.providerOrganizationId ?? null,
      organizationName: session.organization?.name ?? null,
    };
  }

  private normalizeBrainstormOutput(output: BrainstormOutput): { brief: BrainstormBrief } {
    if (!output.brief?.expandedDescription?.trim()) {
      throw new Error('BRAINSTORM_OUTPUT_INVALID: Missing brief content in executor response.');
    }
    return { brief: output.brief };
  }

  /**
   * Only for reading persisted ideation session rows: older data may be flat JSON without `brief`.
   * Live executor responses must already match {@link BrainstormOutput}; do not use this to paper over bad providers.
   */
  private parseLegacyBrainstormSessionOutput(output: unknown): BrainstormBrief | null {
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return null;
    }

    const candidate = output as Record<string, unknown>;
    const briefCandidate =
      candidate.brief && typeof candidate.brief === 'object' && !Array.isArray(candidate.brief)
        ? (candidate.brief as Record<string, unknown>)
        : candidate;

    const expandedDescription = this.readString(briefCandidate.expandedDescription);
    if (!expandedDescription) {
      return null;
    }

    return {
      expandedDescription,
      userStories: this.readLegacyUserStories(briefCandidate.userStories),
      edgeCases: this.readStringArray(briefCandidate.edgeCases),
      successMetrics: this.readStringArray(briefCandidate.successMetrics),
      openQuestions: this.readStringArray(briefCandidate.openQuestions),
      assumptions: this.readStringArray(briefCandidate.assumptions),
      outOfScope: this.readStringArray(briefCandidate.outOfScope),
    };
  }

  private extractBrainstormBrief(output: unknown): BrainstormBrief | null {
    return this.parseLegacyBrainstormSessionOutput(output);
  }

  private readLegacyUserStories(
    value: unknown,
  ): Array<{ role: string; action: string; benefit: string }> {
    if (!Array.isArray(value)) {
      return [];
    }
    const stories: Array<{ role: string; action: string; benefit: string }> = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const row = item as Record<string, unknown>;
      const role = this.readString(row.role);
      const action = this.readString(row.action);
      const benefit = this.readString(row.benefit);
      if (role && action && benefit) {
        stories.push({ role, action, benefit });
      }
    }
    return stories;
  }

  private readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  }

  private normalizeDesignOutput(output: unknown): GenerateDesignOutput {
    return assertStrictGenerateDesignOutput(output);
  }

  /** Ideation sessions may only persist { design } — use for diff checks, not full executor validation. */
  private extractDesignSpecFromSessionOutput(output: unknown): DesignSpec | null {
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return null;
    }
    const o = output as Record<string, unknown>;
    if (o.design && typeof o.design === 'object' && !Array.isArray(o.design)) {
      return o.design as DesignSpec;
    }
    return null;
  }

  private isSameDesignSpec(a: DesignSpec, b: DesignSpec): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private assertDesignHasComponentContextWhenNeeded(
    requirementId: string,
    sessionId: string,
    readyRepos: Array<{ id: string; name: string; localPath: string }>,
    repositoryComponentContext: RepositoryComponentContext | null,
    executor: AIExecutor,
  ): void {
    const isMockExecutor = executor instanceof MockAiExecutor;
    this.logger.log(
      `Ideation design trace requirement=${requirementId} session=${sessionId} executor=${executor.constructor?.name ?? 'unknown'} readyRepoCount=${readyRepos.length} componentContext=${repositoryComponentContext ? 'present' : 'absent'} mock=${isMockExecutor}`,
    );

    if (readyRepos.length === 0) {
      this.logger.warn(
        `Ideation design trace requirement=${requirementId} session=${sessionId}: no READY repositories (need localPath + syncStatus=READY). The model will not receive repo component context.`,
      );
      return;
    }

    if (!repositoryComponentContext && !isMockExecutor) {
      const primary = readyRepos[0];
      const hasMethod =
        'buildRepositoryComponentContext' in executor &&
        typeof (executor as { buildRepositoryComponentContext?: unknown }).buildRepositoryComponentContext ===
          'function';
      const detail = hasMethod
        ? `Scanned ${primary.name} (${primary.id}) at ${primary.localPath} but found no .tsx under known component/page paths (src/components, src/pages, apps/*/src/...).`
        : `Executor ${executor.constructor?.name ?? 'unknown'} has no buildRepositoryComponentContext.`;
      const msg = `DESIGN_COMPONENT_CONTEXT_EMPTY: ${detail}`;
      this.logger.error(`${msg} requirement=${requirementId} session=${sessionId}`);
      throw new Error(msg);
    }
  }


  private async markSupersededWaitingSessions(
    requirementId: string,
    stage: 'BRAINSTORM' | 'DESIGN',
    keepSessionId: string,
  ) {
    await this.prisma.ideationSession.updateMany({
      where: {
        requirementId,
        stage,
        status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
        id: { not: keepSessionId },
      },
      data: {
        status: ideationSessionStatusMap[IdeationSessionStatus.COMPLETED],
        statusMessage: 'Superseded by a newer attempt.',
      },
    });
  }

  /** Brainstorm sessions can be left WAITING_CONFIRMATION after manual DB fixes or edge paths; design cannot coexist with them. */
  private async closeStaleBrainstormWaitingSessions(requirementId: string) {
    await this.prisma.ideationSession.updateMany({
      where: {
        requirementId,
        stage: 'BRAINSTORM',
        status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
      },
      data: {
        status: ideationSessionStatusMap[IdeationSessionStatus.COMPLETED],
        statusMessage: 'Closed: design stage active; stale brainstorm confirmation.',
        finishedAt: new Date(),
      },
    });
  }

  private async getPreviousBriefs(requirementId: string): Promise<BrainstormBrief[]> {
    const artifacts = await this.prisma.ideationArtifact.findMany({
      where: { requirementId, type: 'BRAINSTORM_BRIEF' },
      orderBy: { version: 'asc' },
    });
    return artifacts.map((a) => a.content as unknown as BrainstormBrief);
  }

  private async getConfirmedBrief(requirementId: string): Promise<BrainstormBrief | null> {
    const artifact = await this.prisma.ideationArtifact.findFirst({
      where: { requirementId, type: 'BRAINSTORM_BRIEF' },
      orderBy: { version: 'desc' },
    });
    return artifact ? (artifact.content as unknown as BrainstormBrief) : null;
  }

  private async getConfirmedDesign(requirementId: string): Promise<DesignSpec | null> {
    const artifact = await this.prisma.ideationArtifact.findFirst({
      where: { requirementId, type: 'DESIGN_SPEC' },
      orderBy: { version: 'desc' },
    });
    return artifact ? (artifact.content as unknown as DesignSpec) : null;
  }

  private async getPreviousDesigns(requirementId: string): Promise<DesignSpec[]> {
    const artifacts = await this.prisma.ideationArtifact.findMany({
      where: { requirementId, type: 'DESIGN_SPEC' },
      orderBy: { version: 'asc' },
    });
    return artifacts.map((a) => a.content as unknown as DesignSpec);
  }


  private resolveReadyRepositories(
    requirement: Awaited<ReturnType<typeof this.findOne>>,
  ): Array<{
    id: string;
    name: string;
    url: string;
    defaultBranch: string | null;
    localPath: string;
    syncStatus: string;
  }> {
    const explicit = (requirement.requirementRepositories ?? [])
      .map(
        (rr: {
          repository: {
            id: string;
            name: string;
            url: string;
            defaultBranch: string | null;
            localPath: string | null;
            syncStatus: string | null;
          };
        }) => rr.repository,
      )
      .filter((repo) => Boolean(repo.id));

    const fallback = (
      requirement.project?.workspace?.repositories ??
      requirement.workspace?.repositories ??
      []
    )
      .map((repo: {
        id: string;
        name: string;
        url: string;
        defaultBranch?: string | null;
        localPath?: string | null;
        syncStatus?: string | null;
      }) => ({
        id: repo.id,
        name: repo.name,
        url: repo.url,
        defaultBranch: repo.defaultBranch ?? null,
        localPath: repo.localPath ?? null,
        syncStatus: repo.syncStatus ?? null,
      }))
      .filter((repo) => Boolean(repo.id));

    const candidates = explicit.length > 0 ? explicit : fallback;
    return candidates
      .filter(
        (repo): repo is {
          id: string;
          name: string;
          url: string;
          defaultBranch: string | null;
          localPath: string;
          syncStatus: string;
        } => Boolean(repo.localPath) && repo.syncStatus === 'READY',
      )
      .map((repo) => ({
        id: repo.id,
        name: repo.name,
        url: repo.url,
        defaultBranch: repo.defaultBranch,
        localPath: repo.localPath,
        syncStatus: repo.syncStatus,
      }));
  }

  private getFirstReadyRepositoryId(requirement: Awaited<ReturnType<typeof this.findOne>>): string | null {
    const repositories = this.resolveReadyRepositories(requirement);
    const first = repositories?.[0];
    return first?.id ?? null;
  }

  private async ensureIdeationRepositoriesReady(
    requirement: Awaited<ReturnType<typeof this.findOne>>,
  ): Promise<Awaited<ReturnType<typeof this.findOne>>> {
    if (this.resolveReadyRepositories(requirement).length > 0) {
      return requirement;
    }

    const repositoryIds = Array.from(
      new Set(
        (requirement.requirementRepositories ?? [])
          .map((item: { repository?: { id?: string } }) => item.repository?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (repositoryIds.length === 0) {
      throw new BadRequestException(
        'IDEATION_REPOSITORY_MISSING: No repositories are associated with this requirement. Link a workspace repository and retry.',
      );
    }

    const repositories = await this.prisma.repository.findMany({
      where: {
        id: { in: repositoryIds },
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
    });
    if (repositories.length === 0) {
      throw new BadRequestException(
        'IDEATION_REPOSITORY_MISSING: Linked repositories are not active or cannot be loaded.',
      );
    }

    const syncErrors: string[] = [];
    for (const repository of repositories) {
      try {
        await this.repositorySyncService.syncRepository(repository as any);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        syncErrors.push(`${repository.name}: ${message}`);
      }
    }

    const refreshedRequirement = await this.findOne(requirement.id);
    if (this.resolveReadyRepositories(refreshedRequirement).length > 0) {
      return refreshedRequirement;
    }

    const readinessSummary = this.buildIdeationRepositoryReadinessSummary(refreshedRequirement);
    const details = [
      readinessSummary ? ` Repositories: ${readinessSummary}` : '',
      syncErrors.length > 0 ? ` Sync failed: ${syncErrors.join(' | ')}` : '',
    ].join('');
    throw new BadRequestException(
      `IDEATION_REPOSITORY_NOT_READY: Repositories are not ready for ideation. Please sync repositories from workspace and retry.${details}`,
    );
  }

  private buildIdeationRepositoryReadinessSummary(
    requirement: Awaited<ReturnType<typeof this.findOne>>,
  ): string {
    const repositories = (requirement.requirementRepositories ?? [])
      .map((item: { repository?: Record<string, unknown> }) => item.repository)
      .filter((repo): repo is Record<string, unknown> => Boolean(repo));
    if (repositories.length === 0) {
      return '';
    }
    return repositories
      .map((repo) => {
        const id = typeof repo.id === 'string' ? repo.id : 'unknown-id';
        const name = typeof repo.name === 'string' ? repo.name : 'unknown-name';
        const syncStatus =
          typeof repo.syncStatus === 'string' && repo.syncStatus.trim().length > 0
            ? repo.syncStatus
            : 'UNKNOWN';
        const localPath =
          typeof repo.localPath === 'string' && repo.localPath.trim().length > 0
            ? repo.localPath
            : '(empty)';
        return `${id}/${name}(syncStatus=${syncStatus}, localPath=${localPath})`;
      })
      .join(' | ');
  }

  private async buildRepositoryComponentContext(
    executor: AIExecutor,
    requirement: Awaited<ReturnType<typeof this.findOne>>,
  ): Promise<import('../common/types').RepositoryComponentContext | null> {
    const repositories = this.resolveReadyRepositories(requirement);

    if (!repositories || repositories.length === 0) {
      this.logger.warn(
        `Ideation component context skipped requirement=${requirement.id}: no READY repositories (localPath + syncStatus=READY).`,
      );
      return null;
    }

    // Use the first ready repository as primary context source
    const repo = repositories[0];
    const repoContext: import('../common/types').RepositoryContext = {
      id: repo.id,
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      localPath: repo.localPath,
      syncStatus: repo.syncStatus,
    };

    if (
      'buildRepositoryComponentContext' in executor &&
      typeof (executor as any).buildRepositoryComponentContext === 'function'
    ) {
      const built = await (executor as any).buildRepositoryComponentContext(repoContext);
      if (built) {
        const files = Array.isArray(built.componentFiles) ? built.componentFiles.length : 0;
        const pages = Array.isArray(built.pageExamples) ? built.pageExamples.length : 0;
        this.logger.log(
          `Ideation component context built requirement=${requirement.id} repo=${repo.id} componentFiles=${files} pageExamples=${pages}`,
        );
      } else {
        this.logger.warn(
          `Ideation component context empty after scan requirement=${requirement.id} repo=${repo.id} localPath=${repo.localPath}`,
        );
      }
      return built as import('../common/types').RepositoryComponentContext | null;
    }

    this.logger.warn(
      `Ideation component context unavailable requirement=${requirement.id}: executor ${executor.constructor?.name ?? 'unknown'} has no buildRepositoryComponentContext.`,
    );
    return null;
  }


}
