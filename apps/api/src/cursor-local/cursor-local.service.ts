import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import { buildLocalChatPrompt } from '../workflow/local-chat-prompt';
import { StartLocalChatDto } from './dto/start-local-chat.dto';
import { WorkflowRunStatus, WorkflowRunType } from '../common/enums';

type LocalChatTaskType = 'requirement' | 'bug';

const LOCAL_CHAT_READY_POLL_INTERVAL_MS = 250;
const LOCAL_CHAT_READY_TIMEOUT_MS = 15_000;

type LocalBugContext = {
  title?: string | null;
  description?: string | null;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  reproductionSteps?: unknown;
};

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

  async listTasks(filters: { workspaceId?: string; session?: WorkflowSession }): Promise<LocalChatTaskItem[]> {
    const workspaceFilter = await this.resolveWorkspaceFilter(filters);
    const [requirements, bugs] = await Promise.all([
      this.prisma.requirement.findMany({
        where: {
          status: 'ACTIVE',
          ...workspaceFilter,
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
          ...workspaceFilter,
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
        const localExecutionWorkflow = requirement.workflowRuns.find((workflow) => this.isReportableLocalWorkflow(workflow));
        const activeWorkflow = localExecutionWorkflow ?? requirement.workflowRuns.find((workflow) => this.isActiveWorkflow(workflow));
        return this.buildTaskItem({
          id: requirement.id,
          type: 'requirement',
          title: requirement.title,
          status: requirement.status,
          priority: requirement.priority,
          scheduleSignal: requirement.planningStatus,
          repository,
          workflowRunId: localExecutionWorkflow?.id ?? null,
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
          bug.fixWorkflowRun && this.isActiveWorkflow(bug.fixWorkflowRun)
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
          workflowRunId: activeFixWorkflow && this.isReportableLocalWorkflow(activeFixWorkflow) ? activeFixWorkflow.id : null,
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

  private isActiveWorkflow(workflow: { status: string }) {
    const status = this.normalizeWorkflowStatus(workflow.status);
    return ![WorkflowRunStatus.DONE, WorkflowRunStatus.FAILED].includes(status as WorkflowRunStatus);
  }

  private isReportableLocalWorkflow(workflow: { runType?: string | null; status: string }) {
    return (
      workflow.runType === WorkflowRunType.LOCAL_CHAT &&
      this.normalizeWorkflowStatus(workflow.status) === WorkflowRunStatus.EXECUTION_RUNNING
    );
  }

  private normalizeWorkflowStatus(status: string) {
    return status.toLowerCase();
  }

  private async resolveWorkspaceFilter(filters: { workspaceId?: string; session?: WorkflowSession }) {
    if (filters.workspaceId?.trim()) {
      return { workspaceId: filters.workspaceId.trim() };
    }

    return {};
  }

  async startHandoff(dto: StartLocalChatDto, session?: WorkflowSession) {
    const bugContext =
      dto.taskType === 'bug'
        ? await this.prisma.bug.findUniqueOrThrow({ where: { id: dto.taskId } })
        : null;

    const existingWorkflow = await this.findExistingLocalChatWorkflow(dto);
    if (existingWorkflow) {
      return this.continueLocalChatWorkflow(existingWorkflow, dto, bugContext, session);
    }

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

    const readyWorkflow = await this.waitForLocalChatExecutionPending(workflow);
    if (!readyWorkflow) {
      throw new ConflictException('Local chat workflow repositories are still preparing. Please retry shortly.');
    }

    const claimed = await this.workflowService.claimLocalExecution(readyWorkflow.id, session);
    return this.buildStartHandoffResult(dto, bugContext, claimed.workflow, claimed.handoff);
  }

  private async findExistingLocalChatWorkflow(dto: StartLocalChatDto) {
    if (dto.taskType !== 'requirement') {
      return null;
    }

    const workflows = await this.prisma.workflowRun.findMany({
      where: {
        requirementId: dto.taskId,
        runType: WorkflowRunType.LOCAL_CHAT,
        status: {
          notIn: ['DONE', 'FAILED'],
        },
      },
      include: {
        workflowRepositories: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const repositoryIds = new Set((dto.repositoryIds ?? []).map((id) => id.trim()).filter(Boolean));
    if (repositoryIds.size === 0) {
      return workflows[0] ?? null;
    }

    return (
      workflows.find((workflow) =>
        workflow.workflowRepositories.some((repository) =>
          repository.repositoryId ? repositoryIds.has(repository.repositoryId) : false,
        ),
      ) ?? null
    );
  }

  private async continueLocalChatWorkflow(
    workflow: { id: string; status: string },
    dto: StartLocalChatDto,
    bugContext: LocalBugContext | null,
    session?: WorkflowSession,
  ) {
    const status = this.normalizeWorkflowStatus(workflow.status);
    if (status === WorkflowRunStatus.EXECUTION_PENDING) {
      const claimed = await this.workflowService.claimLocalExecution(workflow.id, session);
      return this.buildStartHandoffResult(dto, bugContext, claimed.workflow, claimed.handoff);
    }

    if (status === WorkflowRunStatus.EXECUTION_RUNNING) {
      const handoff = await this.workflowService.getLocalHandoff(workflow.id);
      return this.buildStartHandoffResult(dto, bugContext, workflow, handoff);
    }

    throw new ConflictException('Local chat workflow repositories are still preparing. Please retry shortly.');
  }

  private async waitForLocalChatExecutionPending(workflow: { id: string; status: string }) {
    if (this.normalizeWorkflowStatus(workflow.status) === WorkflowRunStatus.EXECUTION_PENDING) {
      return workflow;
    }

    const deadline = Date.now() + LOCAL_CHAT_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, LOCAL_CHAT_READY_POLL_INTERVAL_MS));
      const latest = await this.workflowService.findOne(workflow.id);
      const status = this.normalizeWorkflowStatus(latest.status);
      if (status === WorkflowRunStatus.EXECUTION_PENDING) {
        return latest;
      }
      if ([WorkflowRunStatus.FAILED, WorkflowRunStatus.DONE].includes(status as WorkflowRunStatus)) {
        return null;
      }
    }

    return null;
  }

  private buildStartHandoffResult(
    dto: StartLocalChatDto,
    bugContext: LocalBugContext | null,
    workflow: { id: string; status: string },
    handoff: Awaited<ReturnType<WorkflowService['getLocalHandoff']>>,
  ) {
    const repository = handoff.repositories[0];
    const chatPrompt = buildLocalChatPrompt({
      taskType: dto.taskType,
      taskId: dto.taskId,
      workflowRunId: handoff.workflowRunId,
      title: bugContext?.title ?? handoff.requirement.title,
      description: bugContext?.description ?? handoff.requirement.description,
      acceptanceCriteria: dto.taskType === 'requirement' ? handoff.requirement.acceptanceCriteria : undefined,
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
      workflow,
      handoff,
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
