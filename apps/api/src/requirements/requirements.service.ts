import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AI_EXECUTOR_REGISTRY,
  type AIExecutor,
  type AIExecutorRegistry,
} from '../ai/ai-executor';
import {
  AiInvocationContextService,
  type AiInvocationRecipient,
} from '../ai/ai-invocation-context.service';
import { MockAiExecutor } from '../ai/mock-ai.executor';
import { IdeationSessionStatus, IdeationStatus } from '../common/enums';
import { BrainstormBrief, DemoPage, DesignSpec, RepositoryComponentContext } from '../common/types';
import { LocalDevPreviewService } from '../dev-preview/local-dev-preview.service';
import { PrismaService } from '../prisma/prisma.service';
import { RepositorySyncService } from '../workspaces/repository-sync.service';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import {
  IdeationSessionEventsRepository,
  type IdeationSessionEventType,
  type IdeationSessionStage,
} from './ideation-session-events.repository';

const ideationStatusMap: Record<IdeationStatus, string> = {
  [IdeationStatus.NONE]: 'NONE',
  [IdeationStatus.BRAINSTORM_PENDING]: 'BRAINSTORM_PENDING',
  [IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION]: 'BRAINSTORM_WAITING_CONFIRMATION',
  [IdeationStatus.BRAINSTORM_CONFIRMED]: 'BRAINSTORM_CONFIRMED',
  [IdeationStatus.DESIGN_PENDING]: 'DESIGN_PENDING',
  [IdeationStatus.DESIGN_WAITING_CONFIRMATION]: 'DESIGN_WAITING_CONFIRMATION',
  [IdeationStatus.DESIGN_CONFIRMED]: 'DESIGN_CONFIRMED',
  [IdeationStatus.DEMO_PENDING]: 'DEMO_PENDING',
  [IdeationStatus.DEMO_WAITING_CONFIRMATION]: 'DEMO_WAITING_CONFIRMATION',
  [IdeationStatus.DEMO_CONFIRMED]: 'DEMO_CONFIRMED',
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
  ) {}

  async create(dto: CreateRequirementDto) {
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

    return this.prisma.requirement.create({
      data: {
        projectId: dto.projectId,
        title: dto.title,
        description: dto.description,
        acceptanceCriteria: dto.acceptanceCriteria,
        workspaceId: project.workspaceId,
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
      },
    });
  }

  async findAll() {
    return this.prisma.requirement.findMany({
      orderBy: {
        createdAt: 'desc',
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
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.requirement.findUniqueOrThrow({
      where: { id },
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
      },
    });
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
    const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
      undefined,
      this.toAiInvocationRecipient(authSession),
    );

    const session = await this.prisma.ideationSession.create({
      data: {
        requirementId,
        stage: 'BRAINSTORM',
        attempt: previousAttemptCount + 1,
        status: ideationSessionStatusMap[IdeationSessionStatus.RUNNING],
        input: { requirementTitle: requirement.title, requirementDescription: requirement.description, humanHint: hint },
        startedAt: new Date(),
      },
    });

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_PENDING] },
    });

    try {
      const result = await executor.brainstorm(
        {
          requirementTitle: requirement.title,
          requirementDescription: requirement.description,
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
    const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
      undefined,
      this.toAiInvocationRecipient(authSession),
    );

    const session = await this.prisma.ideationSession.create({
      data: {
        requirementId,
        stage: 'BRAINSTORM',
        attempt: previousBriefs.length + 1,
        status: ideationSessionStatusMap[IdeationSessionStatus.RUNNING],
        input: { feedback },
        startedAt: new Date(),
      },
    });

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_PENDING] },
    });

    try {
      const result = await executor.brainstorm(
        {
          requirementTitle: requirement.title,
          requirementDescription: requirement.description,
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
    const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
      undefined,
      this.toAiInvocationRecipient(authSession),
    );

    const session = await this.prisma.ideationSession.create({
      data: {
        requirementId,
        stage: 'DESIGN',
        attempt: previousDesigns.length + 1,
        status: ideationSessionStatusMap[IdeationSessionStatus.RUNNING],
        input: { humanHint: hint },
        startedAt: new Date(),
      },
    });

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_PENDING] },
    });

    try {
      const readyRepos = this.resolveReadyRepositories(requirement);
      this.logger.log(
        `Ideation design start requirement=${requirementId} session=${session.id} executor=${executor.constructor?.name ?? 'unknown'} readyRepoCount=${readyRepos.length}${readyRepos[0] ? ` primaryRepo=${readyRepos[0].id}` : ''}`,
      );

      const rawResult = await executor.generateDesign(
        {
          requirementTitle: requirement.title,
          requirementDescription: requirement.description,
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
    const previousLatestDesign = latestDesignSessionWithOutput?.output
      ? this.normalizeDesignOutput(latestDesignSessionWithOutput.output)
      : null;
    const executor = this.resolveIdeationExecutor();
    const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
      undefined,
      this.toAiInvocationRecipient(authSession),
    );

    const session = await this.prisma.ideationSession.create({
      data: {
        requirementId,
        stage: 'DESIGN',
        attempt: previousDesigns.length + 1,
        status: ideationSessionStatusMap[IdeationSessionStatus.RUNNING],
        input: { feedback },
        startedAt: new Date(),
      },
    });

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_PENDING] },
    });

    try {
      const readyRepos = this.resolveReadyRepositories(requirement);
      this.logger.log(
        `Ideation design revise start requirement=${requirementId} session=${session.id} executor=${executor.constructor?.name ?? 'unknown'} readyRepoCount=${readyRepos.length}${readyRepos[0] ? ` primaryRepo=${readyRepos[0].id}` : ''}`,
      );

      const rawResult = await executor.generateDesign(
        {
          requirementTitle: requirement.title,
          requirementDescription: requirement.description,
          confirmedBrief,
          previousDesigns,
          humanFeedback: feedback,
          repositoryComponentContext: undefined,
        },
        invocationContext,
      );
      let result = this.normalizeDesignOutput(rawResult);

      if (previousLatestDesign && this.isSameDesignOutput(result, previousLatestDesign)) {
        const retryRawResult = await executor.generateDesign(
          {
            requirementTitle: requirement.title,
            requirementDescription: requirement.description,
            confirmedBrief,
            previousDesigns,
            humanFeedback: `${feedback}\n\n请确保本次修订与上一版有明确可见差异：至少调整 2 个页面的布局、关键组件或交互说明，并在 designRationale 开头总结本次具体变更点。`,
            repositoryComponentContext: undefined,
          },
          invocationContext,
        );
        result = this.normalizeDesignOutput(retryRawResult);
      }

      if (previousLatestDesign && this.isSameDesignOutput(result, previousLatestDesign)) {
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

  async startDemoGeneration(requirementId: string, hint?: string, authSession?: IdeationAuthSession) {
    let requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (
      currentStatus !== IdeationStatus.DESIGN_CONFIRMED &&
      currentStatus !== IdeationStatus.DEMO_WAITING_CONFIRMATION
    ) {
      throw new BadRequestException(
        `Cannot start demo generation from status ${currentStatus}. Expected DESIGN_CONFIRMED or DEMO_WAITING_CONFIRMATION.`,
      );
    }

    const confirmedBrief = await this.getConfirmedBrief(requirementId);
    const confirmedDesign = await this.getConfirmedDesign(requirementId);
    if (!confirmedBrief || !confirmedDesign) {
      throw new BadRequestException('Design must be confirmed before generating demo pages.');
    }
    requirement = await this.ensureIdeationRepositoriesReady(requirement);

    const executor = this.resolveIdeationExecutor();
    const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
      undefined,
      this.toAiInvocationRecipient(authSession),
    );
    const previousDemoPages = await this.getPreviousDemoPages(requirementId);
    const session = await this.prisma.ideationSession.create({
      data: {
        requirementId,
        stage: 'DEMO',
        attempt: previousDemoPages.length + 1,
        status: ideationSessionStatusMap[IdeationSessionStatus.RUNNING],
        input: { humanHint: hint },
        statusMessage: '正在生成 Demo 页面（0s）…',
        startedAt: new Date(),
      },
    });

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.DEMO_PENDING] },
    });

    const startedAtMs = Date.now();
    await this.emitDemoGenerationEvent({
      sessionId: session.id,
      eventType: 'STARTED',
      stage: 'QUEUE',
      message: 'Demo generation started.',
      startedAtMs,
      details: { requirementId, attempt: session.attempt },
    });
    await this.emitDemoGenerationEvent({
      sessionId: session.id,
      eventType: 'STAGE',
      stage: 'QUEUE',
      message: 'Queued and preparing repository context.',
      startedAtMs,
    });

    void this.executeDemoGenerationJob({
      requirementId,
      requirement,
      confirmedBrief,
      confirmedDesign,
      hint,
      sessionId: session.id,
      startedAtMs,
      executor,
      invocationContext,
    });

    return this.findOne(requirementId);
  }

  async reviseDemoGeneration(requirementId: string, feedback: string, authSession?: IdeationAuthSession) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.DEMO_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot revise demo generation from status ${currentStatus}. Expected DEMO_WAITING_CONFIRMATION.`,
      );
    }

    return this.startDemoGeneration(requirementId, feedback, authSession);
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

  private async executeDemoGenerationJob(input: {
    requirementId: string;
    requirement: any;
    confirmedBrief: BrainstormBrief;
    confirmedDesign: DesignSpec;
    hint?: string;
    sessionId: string;
    startedAtMs: number;
    executor: AIExecutor;
    invocationContext: any;
  }) {
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      const timeoutMs = this.getDemoGenerationTimeoutMs();
      heartbeat = setInterval(() => {
        void this.emitDemoGenerationEvent({
          sessionId: input.sessionId,
          eventType: 'HEARTBEAT',
          stage: 'MODEL_RUNNING',
          message: 'Demo generation still running.',
          startedAtMs: input.startedAtMs,
        });
      }, 10_000);

      const readyRepos = this.resolveReadyRepositories(input.requirement);
      const includeComponentContext = this.shouldIncludeComponentContextForDemo();
      await this.emitDemoGenerationEvent({
        sessionId: input.sessionId,
        eventType: 'STAGE',
        stage: 'CONTEXT_SCAN',
        message: 'Scanning repository component context.',
        startedAtMs: input.startedAtMs,
        details: { readyRepoCount: readyRepos.length, includeComponentContext },
      });
      const repositorySummary = await this.buildDemoRepositorySummary(input.requirement);
      const repositoryComponentContext = includeComponentContext
        ? await this.buildRepositoryComponentContext(input.executor, input.requirement)
        : null;
      const narrowedComponentContext = includeComponentContext
        ? this.narrowRepositoryComponentContextForDemo(repositoryComponentContext)
        : null;
      await this.emitDemoGenerationEvent({
        sessionId: input.sessionId,
        eventType: 'STAGE',
        stage: 'CONTEXT_SCAN',
        message: includeComponentContext
          ? narrowedComponentContext
            ? 'Repository context scanned.'
            : 'Repository context unavailable, continuing.'
          : 'Using lightweight repository summary only.',
        startedAtMs: input.startedAtMs,
      });
      await this.emitDemoGenerationEvent({
        sessionId: input.sessionId,
        eventType: 'STAGE',
        stage: 'MODEL_RUNNING',
        message: 'Invoking AI for demo page generation.',
        startedAtMs: input.startedAtMs,
      });

      const baseFeedback = `${input.hint?.trim() || ''}\n\n仅生成 demoPages，用于本地预览。保持已确认 design 不变。`.trim();
      const scopedFeedback = `${baseFeedback}\n\n仓库结构摘要:\n${repositorySummary}`.trim();
      const rawResult = await this.generateDemoWithSingleRetry({
        input,
        timeoutMs,
        humanFeedback: scopedFeedback,
        repositoryComponentContext: narrowedComponentContext ?? undefined,
      });
      await this.emitDemoGenerationEvent({
        sessionId: input.sessionId,
        eventType: 'STAGE',
        stage: 'JSON_PARSE',
        message: 'AI response received, validating structured output.',
        startedAtMs: input.startedAtMs,
      });
      const result = this.normalizeDesignOutput(rawResult);
      if (!result.demoPages || result.demoPages.length === 0) {
        throw new Error('DEMO_PAGES_EMPTY: Demo generation returned no demoPages.');
      }

      await this.emitDemoGenerationEvent({
        sessionId: input.sessionId,
        eventType: 'STAGE',
        stage: 'WRITE_FILES',
        message: `Writing ${result.demoPages.length} demo page(s) to repository.`,
        startedAtMs: input.startedAtMs,
        details: { demoPageCount: result.demoPages.length },
      });
      await this.writeDemoPagesToRepo(result.demoPages, input.requirement);
      const primaryRepoId = this.getFirstReadyRepositoryId(input.requirement);
      if (primaryRepoId) {
        await this.emitDemoGenerationEvent({
          sessionId: input.sessionId,
          eventType: 'STAGE',
          stage: 'PREVIEW_START',
          message: 'Restarting local preview service.',
          startedAtMs: input.startedAtMs,
          details: { repositoryId: primaryRepoId },
        });
        await this.localDevPreviewService.restartAfterDesignWrite(primaryRepoId);
      }

      await this.emitDemoGenerationEvent({
        sessionId: input.sessionId,
        eventType: 'COMPLETED',
        stage: 'FINALIZE',
        message: `Demo pages generated (${result.demoPages.length}), waiting for confirmation.`,
        startedAtMs: input.startedAtMs,
        includeElapsed: false,
      });
      await this.prisma.ideationSession.update({
        where: { id: input.sessionId },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
          output: { demoPages: result.demoPages } as any,
          finishedAt: new Date(),
          statusMessage: `Demo pages generated (${result.demoPages.length}), waiting for confirmation.`,
        },
      });
      await this.markSupersededWaitingSessions(input.requirementId, 'DEMO', input.sessionId);

      await this.prisma.requirement.update({
        where: { id: input.requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.DEMO_WAITING_CONFIRMATION] },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown demo generation error';
      this.logger.error(`Demo generation failed for requirement ${input.requirementId}: ${message}`);
      await this.emitDemoGenerationEvent({
        sessionId: input.sessionId,
        eventType: 'FAILED',
        stage: 'FINALIZE',
        message: `Demo generation failed: ${message}`,
        startedAtMs: input.startedAtMs,
        includeElapsed: false,
      });

      await this.prisma.ideationSession.update({
        where: { id: input.sessionId },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.FAILED],
          errorMessage: message,
          finishedAt: new Date(),
        },
      });
      await this.prisma.requirement.update({
        where: { id: input.requirementId },
        data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_CONFIRMED] },
      });
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }

  async confirmDemoGeneration(requirementId: string) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;
    if (currentStatus !== IdeationStatus.DEMO_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot confirm demo generation from status ${currentStatus}. Expected DEMO_WAITING_CONFIRMATION.`,
      );
    }

    const lastSession = requirement.ideationSessions
      ?.filter((s: { stage: string }) => s.stage === 'DEMO')
      .sort((a: { attempt: number }, b: { attempt: number }) => b.attempt - a.attempt)[0];
    if (lastSession?.output) {
      const output = lastSession.output as { demoPages?: DemoPage[] };
      if (output.demoPages && output.demoPages.length > 0) {
        await this.prisma.ideationArtifact.create({
          data: {
            requirementId,
            type: 'DEMO_PAGE',
            content: output.demoPages as any,
          },
        });
      } else {
        throw new BadRequestException('当前轮次没有可确认的 demoPages，请重新生成后再确认。');
      }

      await this.prisma.ideationSession.update({
        where: { id: lastSession.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.COMPLETED],
          statusMessage: 'Confirmed by user.',
        },
      });
      await this.markSupersededWaitingSessions(requirementId, 'DEMO', lastSession.id);
    }

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.DEMO_CONFIRMED] },
    });

    return this.findOne(requirementId);
  }

  async finalizeIdeation(requirementId: string) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.DEMO_CONFIRMED && currentStatus !== IdeationStatus.DESIGN_CONFIRMED) {
      throw new BadRequestException(
        `Cannot finalize ideation from status ${currentStatus}. Expected DEMO_CONFIRMED.`,
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

  private normalizeBrainstormOutput(output: unknown): { brief: BrainstormBrief } {
    const brief = this.extractBrainstormBrief(output);
    if (!brief) {
      throw new Error('BRAINSTORM_OUTPUT_INVALID: Missing brief content in executor response.');
    }
    return { brief };
  }

  private extractBrainstormBrief(output: unknown): BrainstormBrief | null {
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
      userStories: this.readUserStories(briefCandidate.userStories),
      edgeCases: this.readStringArray(briefCandidate.edgeCases),
      successMetrics: this.readStringArray(briefCandidate.successMetrics),
      openQuestions: this.readStringArray(briefCandidate.openQuestions),
      assumptions: this.readStringArray(briefCandidate.assumptions),
      outOfScope: this.readStringArray(briefCandidate.outOfScope),
    };
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

  private readUserStories(
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

  private normalizeDesignOutput(output: unknown): { design: DesignSpec; demoPages?: DemoPage[] } {
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      throw new Error('DESIGN_OUTPUT_INVALID: Design output is not an object.');
    }
    const candidate = output as Record<string, unknown>;
    const designCandidate =
      candidate.design && typeof candidate.design === 'object' && !Array.isArray(candidate.design)
        ? (candidate.design as Record<string, unknown>)
        : candidate;

    const overview = this.readString(designCandidate.overview);
    if (!overview) {
      throw new Error('DESIGN_OUTPUT_INVALID: Missing design overview in executor response.');
    }

    const normalized: { design: DesignSpec; demoPages?: DemoPage[] } = {
      design: designCandidate as unknown as DesignSpec,
    };

    if (Array.isArray(candidate.demoPages)) {
      normalized.demoPages = candidate.demoPages as DemoPage[];
    }

    return normalized;
  }

  private isSameDesignOutput(
    a: { design: DesignSpec; demoPages?: DemoPage[] },
    b: { design: DesignSpec; demoPages?: DemoPage[] },
  ): boolean {
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
        `Ideation design trace requirement=${requirementId} session=${sessionId}: no READY repositories (need localPath + syncStatus=READY). The model will not receive repo component context; demoPages are usually empty.`,
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

  private appendDesignDemoHintForUser(
    demoCount: number,
    readyRepoCount: number,
    isMockExecutor: boolean,
    hadComponentContext: boolean,
  ): string {
    if (demoCount > 0) {
      return '';
    }
    if (readyRepoCount === 0) {
      return '（无已同步的 READY 仓库，未生成 demoPages；请在工作区同步仓库或在需求中关联仓库后再重新生成。）';
    }
    if (isMockExecutor) {
      return '（当前为 Mock AI，未注入仓库组件扫描，未生成 demoPages；请改用真实执行器。）';
    }
    if (!hadComponentContext) {
      return '';
    }
    return '（未返回 demoPages；请查看 API 日志中的 DESIGN_DEMO_PAGES_EMPTY 或模型输出。）';
  }

  private async emitDemoGenerationEvent(input: {
    sessionId: string;
    eventType: IdeationSessionEventType;
    stage: IdeationSessionStage;
    message: string;
    startedAtMs: number;
    details?: Record<string, unknown>;
    includeElapsed?: boolean;
  }) {
    await this.ideationSessionEventsRepository.append({
      sessionId: input.sessionId,
      eventType: input.eventType,
      stage: input.stage,
      message: input.message,
      details: input.details,
    });

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - input.startedAtMs) / 1000));
    const includeElapsed = input.includeElapsed ?? true;
    const statusMessage = includeElapsed ? `${input.message} (${elapsedSeconds}s)` : input.message;

    await this.prisma.ideationSession.update({
      where: { id: input.sessionId },
      data: { statusMessage },
    });
  }

  private narrowRepositoryComponentContextForDemo(
    context: RepositoryComponentContext | null,
  ): RepositoryComponentContext | null {
    if (!context) {
      return null;
    }
    return {
      componentFiles: context.componentFiles.slice(0, 40),
      propTypes: context.propTypes.slice(0, 40),
      pageExamples: context.pageExamples.slice(0, 6),
      designTokens: context.designTokens,
    };
  }

  private shouldIncludeComponentContextForDemo(): boolean {
    const raw = process.env.FLOWX_DEMO_INCLUDE_COMPONENT_CONTEXT?.trim().toLowerCase();
    if (!raw) {
      return false;
    }
    return ['1', 'true', 'yes', 'on'].includes(raw);
  }

  private async buildDemoRepositorySummary(
    requirement: Awaited<ReturnType<typeof this.findOne>>,
  ): Promise<string> {
    const repositories = this.resolveReadyRepositories(requirement);
    if (!repositories.length) {
      return '- 无 READY 仓库可用。';
    }
    const { readdir } = require('fs/promises');
    const { join } = require('path');
    const lines: string[] = [];
    for (const repo of repositories.slice(0, 2)) {
      lines.push(`- ${repo.name}: ${repo.localPath}`);
      const candidates = ['apps', 'packages', 'src', 'app', 'pages', 'components'];
      for (const dir of candidates) {
        try {
          const entries = await readdir(join(repo.localPath, dir), { withFileTypes: true });
          const names = entries
            .slice(0, 8)
            .map((entry: { name: string; isDirectory: () => boolean }) =>
              entry.isDirectory() ? `${entry.name}/` : entry.name,
            );
          if (names.length > 0) {
            lines.push(`  ${dir}/: ${names.join(', ')}`);
          }
        } catch {
          // ignore missing directories
        }
      }
    }
    return lines.join('\n') || '- 仓库结构读取为空。';
  }

  private isRetryableDemoGenerationError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('demo_generation_timeout') ||
      normalized.includes('timed out') ||
      normalized.includes('did not contain json') ||
      normalized.includes('empty')
    );
  }

  private async generateDemoWithSingleRetry(input: {
    input: {
      requirementId: string;
      requirement: any;
      confirmedBrief: BrainstormBrief;
      confirmedDesign: DesignSpec;
      hint?: string;
      sessionId: string;
      startedAtMs: number;
      executor: AIExecutor;
      invocationContext: any;
    };
    timeoutMs: number;
    humanFeedback: string;
    repositoryComponentContext?: RepositoryComponentContext;
  }) {
    const runGenerate = (humanFeedback: string) =>
      this.runWithTimeout(
        input.input.executor.generateDesign(
          {
            requirementTitle: input.input.requirement.title,
            requirementDescription: input.input.requirement.description,
            confirmedBrief: input.input.confirmedBrief,
            previousDesigns: [input.input.confirmedDesign],
            humanFeedback,
            repositoryComponentContext: input.repositoryComponentContext,
          },
          input.input.invocationContext,
        ),
        input.timeoutMs,
        `DEMO_GENERATION_TIMEOUT: Demo generation exceeded ${input.timeoutMs}ms without completion.`,
      );

    try {
      return await runGenerate(input.humanFeedback);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.isRetryableDemoGenerationError(message)) {
        throw error;
      }
      await this.emitDemoGenerationEvent({
        sessionId: input.input.sessionId,
        eventType: 'RETRY',
        stage: 'MODEL_RUNNING',
        message: 'First attempt stalled, retrying once with stricter instructions.',
        startedAtMs: input.input.startedAtMs,
        details: { reason: message.slice(0, 240) },
      });
      const retryFeedback = `${input.humanFeedback}\n\n重试要求：\n1) 只输出最终 JSON，不要输出解释文本。\n2) 只生成 1-2 个最小可运行 demoPages。\n3) 优先复用已有组件，禁止额外遍历仓库。`;
      return runGenerate(retryFeedback);
    }
  }

  private getDemoGenerationTimeoutMs(): number {
    const raw = process.env.FLOWX_DEMO_GENERATION_TIMEOUT_MS;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return 1_200_000;
  }

  private async runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timeoutRef: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutRef = setTimeout(() => {
            reject(new Error(timeoutMessage));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutRef) {
        clearTimeout(timeoutRef);
      }
    }
  }

  private async markSupersededWaitingSessions(
    requirementId: string,
    stage: 'BRAINSTORM' | 'DESIGN' | 'DEMO',
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

  private async getPreviousDemoPages(requirementId: string): Promise<DemoPage[][]> {
    const artifacts = await this.prisma.ideationArtifact.findMany({
      where: { requirementId, type: 'DEMO_PAGE' },
      orderBy: { version: 'asc' },
    });
    return artifacts.map((a) => a.content as unknown as DemoPage[]);
  }

  // ── Demo helpers ──

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

  private async writeDemoPagesToRepo(
    demoPages: DemoPage[],
    requirement: Awaited<ReturnType<typeof this.findOne>>,
  ): Promise<void> {
    const { execFile: execFileCb } = require('child_process');
    const { promisify } = require('util');
    const { writeFile: writeFileCb, mkdir: mkdirCb } = require('fs/promises');
    const { join } = require('path');
    const execFile = promisify(execFileCb);

    const repositories = this.resolveReadyRepositories(requirement);

    if (!repositories || repositories.length === 0) {
      this.logger.warn(`No ready repositories found for requirement ${requirement.id}, skipping demo page write.`);
      return;
    }

    const repo = repositories[0];

    for (const page of demoPages) {
      try {
        const fullPath = join(repo.localPath, page.filePath);
        const dir = require('path').dirname(fullPath);
        await mkdirCb(dir, { recursive: true });
        await writeFileCb(fullPath, page.componentCode, 'utf8');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown write error';
        this.logger.warn(`Failed to write demo page ${page.filePath}: ${message}`);
      }
    }

    // Git commit
    try {
      await execFile('git', ['add', '.'], { cwd: repo.localPath });
      await execFile('git', ['commit', '-m', `flowx: demo page for requirement ${requirement.id}`], { cwd: repo.localPath });
      this.logger.log(`Demo pages committed for requirement ${requirement.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown git error';
      this.logger.warn(`Failed to commit demo pages for requirement ${requirement.id}: ${message}`);
    }
  }

}
