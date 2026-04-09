import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AI_EXECUTOR_REGISTRY, type AIExecutor, type AIExecutorProvider, type AIExecutorRegistry } from '../ai/ai-executor';
import { IdeationSessionStatus, IdeationStatus } from '../common/enums';
import { BrainstormBrief, DesignSpec } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequirementDto } from './dto/create-requirement.dto';

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

@Injectable()
export class RequirementsService {
  private readonly logger = new Logger(RequirementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_EXECUTOR_REGISTRY) private readonly executorRegistry: AIExecutorRegistry,
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

  async startBrainstorm(requirementId: string, hint?: string) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.NONE && currentStatus !== IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot start brainstorm from status ${currentStatus}. Expected NONE or BRAINSTORM_WAITING_CONFIRMATION.`,
      );
    }

    const previousBriefs = await this.getPreviousBriefs(requirementId);
    const previousAttemptCount = previousBriefs.length;
    const executor = this.getExecutor();

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
      const result = await executor.brainstorm({
        requirementTitle: requirement.title,
        requirementDescription: requirement.description,
        previousBriefs: previousBriefs.length > 0 ? previousBriefs : undefined,
        humanFeedback: hint || undefined,
        workspaceContext: requirement.workspace?.name || undefined,
      });

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
          output: result as any,
          finishedAt: new Date(),
          statusMessage: 'Brainstorm completed, waiting for confirmation.',
        },
      });

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

  async reviseBrainstorm(requirementId: string, feedback: string) {
    const requirement = await this.findOne(requirementId);
    const currentStatus = requirement.ideationStatus as IdeationStatus;

    if (currentStatus !== IdeationStatus.BRAINSTORM_WAITING_CONFIRMATION) {
      throw new BadRequestException(
        `Cannot revise brainstorm from status ${currentStatus}. Expected BRAINSTORM_WAITING_CONFIRMATION.`,
      );
    }

    const executor = this.getExecutor();
    const previousBriefs = await this.getPreviousBriefs(requirementId);

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
      const result = await executor.brainstorm({
        requirementTitle: requirement.title,
        requirementDescription: requirement.description,
        previousBriefs,
        humanFeedback: feedback,
        workspaceContext: requirement.workspace?.name || undefined,
      });

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
          output: result as any,
          finishedAt: new Date(),
          statusMessage: 'Brainstorm revised, waiting for confirmation.',
        },
      });

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

    const lastSession = requirement.ideationSessions
      ?.filter((s: { stage: string }) => s.stage === 'BRAINSTORM')
      .sort((a: { attempt: number }, b: { attempt: number }) => b.attempt - a.attempt)[0];

    if (lastSession?.output) {
      const output = lastSession.output as { brief?: BrainstormBrief };
      if (output.brief) {
        await this.prisma.ideationArtifact.create({
          data: {
            requirementId,
            type: 'BRAINSTORM_BRIEF',
            content: output.brief as any,
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
    }

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.BRAINSTORM_CONFIRMED] },
    });

    return this.findOne(requirementId);
  }

  async startDesign(requirementId: string, hint?: string) {
    const requirement = await this.findOne(requirementId);
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

    const previousDesigns = await this.getPreviousDesigns(requirementId);
    const executor = this.getExecutor();

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
      const result = await executor.generateDesign({
        requirementTitle: requirement.title,
        requirementDescription: requirement.description,
        confirmedBrief,
        previousDesigns: previousDesigns.length > 0 ? previousDesigns : undefined,
        humanFeedback: hint || undefined,
      });

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
          output: result as any,
          finishedAt: new Date(),
          statusMessage: 'Design generation completed, waiting for confirmation.',
        },
      });

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

  async reviseDesign(requirementId: string, feedback: string) {
    const requirement = await this.findOne(requirementId);
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

    const previousDesigns = await this.getPreviousDesigns(requirementId);
    const executor = this.getExecutor();

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
      const result = await executor.generateDesign({
        requirementTitle: requirement.title,
        requirementDescription: requirement.description,
        confirmedBrief,
        previousDesigns,
        humanFeedback: feedback,
      });

      await this.prisma.ideationSession.update({
        where: { id: session.id },
        data: {
          status: ideationSessionStatusMap[IdeationSessionStatus.WAITING_CONFIRMATION],
          output: result as any,
          finishedAt: new Date(),
          statusMessage: 'Design revised, waiting for confirmation.',
        },
      });

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
    }

    await this.prisma.requirement.update({
      where: { id: requirementId },
      data: { ideationStatus: ideationStatusMap[IdeationStatus.DESIGN_CONFIRMED] },
    });

    return this.findOne(requirementId);
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

  private getExecutor(): AIExecutor {
    const defaultProvider = (process.env.AI_EXECUTOR_DEFAULT_PROVIDER as AIExecutorProvider) || 'codex';
    return this.executorRegistry.get(defaultProvider);
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

  private async getPreviousDesigns(requirementId: string): Promise<DesignSpec[]> {
    const artifacts = await this.prisma.ideationArtifact.findMany({
      where: { requirementId, type: 'DESIGN_SPEC' },
      orderBy: { version: 'asc' },
    });
    return artifacts.map((a) => a.content as unknown as DesignSpec);
  }
}
