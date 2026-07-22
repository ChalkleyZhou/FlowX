import { ConflictException, Injectable } from '@nestjs/common';
import { WorkflowRunStatus, WorkflowRunType } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';
import { buildLocalChatPrompt } from '../workflow/local-chat-prompt';
import { WorkflowService } from '../workflow/workflow.service';
import { ContextPackageService } from './context-package.service';
import type { StartEdgeHandoffDto } from './dto/start-edge-handoff.dto';
import type { EdgeWorkflowSession } from './edge-tasks.service';

const EDGE_READY_POLL_INTERVAL_MS = 250;
const EDGE_READY_TIMEOUT_MS = 15_000;

type BugContext = {
  title?: string | null;
  description?: string | null;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  reproductionSteps?: unknown;
};

@Injectable()
export class EdgeHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowService: WorkflowService,
    private readonly contextPackageService: ContextPackageService,
  ) {}

  async startHandoff(dto: StartEdgeHandoffDto, session?: EdgeWorkflowSession) {
    const bugContext =
      dto.taskType === 'bug'
        ? await this.prisma.bug.findUniqueOrThrow({ where: { id: dto.taskId } })
        : null;
    const existingWorkflow = await this.findExistingLocalChatWorkflow(dto);
    if (existingWorkflow) {
      return this.continueWorkflow(existingWorkflow, dto, bugContext, session);
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
    const readyWorkflow = await this.waitForExecutionPending(workflow);
    if (!readyWorkflow) {
      throw new ConflictException('Local chat workflow repositories are still preparing. Please retry shortly.');
    }
    const claimed = await this.workflowService.claimLocalExecution(
      readyWorkflow.id,
      session,
      dto.sourceTool,
    );
    return this.buildResult(dto, bugContext, claimed.workflow, claimed.handoff);
  }

  private async findExistingLocalChatWorkflow(dto: StartEdgeHandoffDto) {
    if (dto.taskType !== 'requirement') return null;
    const workflows = await this.prisma.workflowRun.findMany({
      where: {
        requirementId: dto.taskId,
        runType: WorkflowRunType.LOCAL_CHAT,
        status: { notIn: ['DONE', 'FAILED'] },
      },
      include: { workflowRepositories: true },
      orderBy: { createdAt: 'desc' },
    });
    const repositoryIds = new Set((dto.repositoryIds ?? []).map((id) => id.trim()).filter(Boolean));
    if (!repositoryIds.size) return workflows[0] ?? null;
    return (
      workflows.find((workflow) =>
        workflow.workflowRepositories.some((repository) =>
          repository.repositoryId ? repositoryIds.has(repository.repositoryId) : false,
        ),
      ) ?? null
    );
  }

  private async continueWorkflow(
    workflow: { id: string; status: string },
    dto: StartEdgeHandoffDto,
    bugContext: BugContext | null,
    session?: EdgeWorkflowSession,
  ) {
    const status = workflow.status.toLowerCase();
    if (status === WorkflowRunStatus.EXECUTION_PENDING) {
      const claimed = await this.workflowService.claimLocalExecution(
        workflow.id,
        session,
        dto.sourceTool,
      );
      return this.buildResult(dto, bugContext, claimed.workflow, claimed.handoff);
    }
    if (status === WorkflowRunStatus.EXECUTION_RUNNING) {
      const handoff = await this.workflowService.getLocalHandoff(workflow.id);
      return this.buildResult(dto, bugContext, workflow, handoff);
    }
    throw new ConflictException('Local chat workflow repositories are still preparing. Please retry shortly.');
  }

  private async waitForExecutionPending(workflow: { id: string; status: string }) {
    if (workflow.status.toLowerCase() === WorkflowRunStatus.EXECUTION_PENDING) return workflow;
    const deadline = Date.now() + EDGE_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, EDGE_READY_POLL_INTERVAL_MS));
      const latest = await this.workflowService.findOne(workflow.id);
      const status = latest.status.toLowerCase();
      if (status === WorkflowRunStatus.EXECUTION_PENDING) return latest;
      if ([WorkflowRunStatus.FAILED, WorkflowRunStatus.DONE].includes(status as WorkflowRunStatus)) {
        return null;
      }
    }
    return null;
  }

  private buildResult(
    dto: StartEdgeHandoffDto,
    bugContext: BugContext | null,
    workflow: { id: string; status: string },
    handoff: Awaited<ReturnType<WorkflowService['getLocalHandoff']>>,
  ) {
    const repository = handoff.repositories[0];
    const chatPrompt = buildLocalChatPrompt({
      sourceTool: dto.sourceTool,
      taskType: dto.taskType,
      taskId: dto.taskId,
      workflowRunId: handoff.workflowRunId,
      title: bugContext?.title ?? handoff.requirement.title,
      description: bugContext?.description ?? handoff.requirement.description,
      acceptanceCriteria:
        dto.taskType === 'requirement' ? handoff.requirement.acceptanceCriteria : undefined,
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
      contextPackage: this.contextPackageService.fromHandoff({
        taskType: dto.taskType,
        taskId: dto.taskId,
        sourceTool: dto.sourceTool,
        handoff,
        bugContext,
      }),
      chatPrompt,
      sourceTool: dto.sourceTool,
      taskType: dto.taskType,
      taskId: dto.taskId,
    };
  }
}
