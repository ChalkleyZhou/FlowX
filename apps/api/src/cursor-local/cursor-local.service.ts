import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import { buildLocalChatPrompt } from '../workflow/local-chat-prompt';
import { StartLocalChatDto } from './dto/start-local-chat.dto';

type LocalChatTaskType = 'requirement' | 'bug';

type WorkflowSession = {
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

export interface LocalChatTaskItem {
  id: string;
  type: LocalChatTaskType;
  title: string;
  status: string;
  priority?: string | null;
  scheduleSignal?: string | null;
  repository: { id: string; name: string; url: string | null } | null;
  workflowRunId: string | null;
  eligible: boolean;
  ineligibleReason?: string;
}

@Injectable()
export class CursorLocalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowService: WorkflowService,
  ) {}

  async listTasks(filters: { workspaceId?: string }): Promise<LocalChatTaskItem[]> {
    const [requirements, bugs] = await Promise.all([
      this.prisma.requirement.findMany({
        where: {
          status: 'ACTIVE',
          ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
        },
        include: {
          requirementRepositories: {
            include: { repository: true },
            orderBy: { createdAt: 'asc' },
          },
          workflowRuns: {
            include: { workflowRepositories: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.bug.findMany({
        where: {
          status: { in: ['OPEN', 'CONFIRMED'] },
          ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
        },
        include: {
          repository: true,
          fixWorkflowRun: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return [
      ...requirements.map((requirement) => {
        const repository = requirement.requirementRepositories[0]?.repository ?? null;
        const activeWorkflow = requirement.workflowRuns.find(
          (workflow) => !['DONE', 'FAILED'].includes(workflow.status),
        );
        return this.buildTaskItem({
          id: requirement.id,
          type: 'requirement',
          title: requirement.title,
          status: requirement.status,
          priority: requirement.priority,
          scheduleSignal: requirement.planningStatus,
          repository,
          workflowRunId: activeWorkflow?.id ?? null,
          eligible: !!repository && !activeWorkflow,
          ineligibleReason: !repository
            ? 'No active repository is bound to this requirement.'
            : activeWorkflow
              ? `Active workflow ${activeWorkflow.id} already exists.`
              : undefined,
        });
      }),
      ...bugs.map((bug) => {
        const activeFixWorkflow =
          bug.fixWorkflowRun && !['DONE', 'FAILED'].includes(bug.fixWorkflowRun.status)
            ? bug.fixWorkflowRun
            : null;
        return this.buildTaskItem({
          id: bug.id,
          type: 'bug',
          title: bug.title,
          status: bug.status,
          priority: bug.priority,
          scheduleSignal: null,
          repository: bug.repository,
          workflowRunId: activeFixWorkflow?.id ?? null,
          eligible: !!bug.repository && !activeFixWorkflow,
          ineligibleReason: !bug.repository
            ? 'No repository is bound to this bug.'
            : activeFixWorkflow
              ? `Active fix workflow ${activeFixWorkflow.id} already exists.`
              : undefined,
        });
      }),
    ];
  }

  async startHandoff(dto: StartLocalChatDto, session?: WorkflowSession) {
    const bugContext =
      dto.taskType === 'bug'
        ? await this.prisma.bug.findUniqueOrThrow({ where: { id: dto.taskId } })
        : null;
    const workflow =
      dto.taskType === 'bug'
        ? await this.workflowService.createLocalChatBugWorkflowRun(dto.taskId, {
            repositoryIds: dto.repositoryIds,
            aiProvider: dto.aiProvider,
          })
        : await this.workflowService.createLocalChatWorkflowRun({
            requirementId: dto.taskId,
            repositoryIds: dto.repositoryIds,
            aiProvider: dto.aiProvider,
          });

    if (workflow.status !== 'EXECUTION_PENDING') {
      throw new ConflictException('Local chat workflow repositories are still preparing. Please retry shortly.');
    }

    const claimed = await this.workflowService.claimLocalExecution(workflow.id, session);
    const repository = claimed.handoff.repositories[0];
    const chatPrompt = buildLocalChatPrompt({
      taskType: dto.taskType,
      taskId: dto.taskId,
      workflowRunId: claimed.handoff.workflowRunId,
      title: bugContext?.title ?? claimed.handoff.requirement.title,
      description: bugContext?.description ?? claimed.handoff.requirement.description,
      acceptanceCriteria: dto.taskType === 'requirement' ? claimed.handoff.requirement.acceptanceCriteria : undefined,
      expectedBehavior: bugContext?.expectedBehavior,
      actualBehavior: bugContext?.actualBehavior,
      reproductionSteps: Array.isArray(bugContext?.reproductionSteps)
        ? bugContext.reproductionSteps.map(String)
        : [],
      repository: {
        name: repository?.name ?? 'unknown',
        url: repository?.url ?? null,
        workingBranch: repository?.workingBranch ?? '',
      },
    });

    return {
      workflow: claimed.workflow,
      handoff: claimed.handoff,
      chatPrompt,
      taskType: dto.taskType,
      taskId: dto.taskId,
    };
  }

  async getTaskContext(type: LocalChatTaskType, id: string) {
    if (type === 'requirement') {
      return this.prisma.requirement.findUniqueOrThrow({
        where: { id },
        include: {
          requirementRepositories: {
            include: { repository: true },
          },
        },
      });
    }
    return this.prisma.bug.findUniqueOrThrow({
      where: { id },
      include: {
        repository: true,
        fixWorkflowRun: true,
      },
    });
  }

  private buildTaskItem(input: {
    id: string;
    type: LocalChatTaskType;
    title: string;
    status: string;
    priority?: string | null;
    scheduleSignal?: string | null;
    repository: { id: string; name: string; url: string | null } | null;
    workflowRunId: string | null;
    eligible: boolean;
    ineligibleReason?: string;
  }): LocalChatTaskItem {
    return {
      id: input.id,
      type: input.type,
      title: input.title,
      status: input.status,
      priority: input.priority ?? null,
      scheduleSignal: input.scheduleSignal ?? null,
      repository: input.repository
        ? {
            id: input.repository.id,
            name: input.repository.name,
            url: input.repository.url,
          }
        : null,
      workflowRunId: input.workflowRunId,
      eligible: input.eligible,
      ...(input.ineligibleReason ? { ineligibleReason: input.ineligibleReason } : {}),
    };
  }
}
