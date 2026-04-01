import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { execFile as execFileCallback } from 'child_process';
import { access } from 'fs/promises';
import { Prisma } from '@prisma/client';
import { promisify } from 'util';
import { AI_EXECUTOR, AIExecutor } from '../ai/ai-executor';
import {
  HumanReviewDecision,
  StageExecutionStatus,
  StageType,
  WorkflowRunStatus,
} from '../common/enums';
import {
  GeneratePlanOutput,
  ReviewCodeOutput,
  SplitTasksOutput,
} from '../common/types';
import { dirname, join, sep } from 'path';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { DingTalkNotificationService } from '../notifications/dingtalk-notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RepositorySyncService } from '../workspaces/repository-sync.service';
import { CreateWorkflowRunDto } from './dto/create-workflow-run.dto';

const execFile = promisify(execFileCallback);

const workflowStatusMap: Record<WorkflowRunStatus, string> = {
  [WorkflowRunStatus.CREATED]: 'CREATED',
  [WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING]: 'REPOSITORY_GROUNDING_PENDING',
  [WorkflowRunStatus.TASK_SPLIT_PENDING]: 'TASK_SPLIT_PENDING',
  [WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION]:
    'TASK_SPLIT_WAITING_CONFIRMATION',
  [WorkflowRunStatus.TASK_SPLIT_CONFIRMED]:
    'TASK_SPLIT_CONFIRMED',
  [WorkflowRunStatus.PLAN_PENDING]: 'PLAN_PENDING',
  [WorkflowRunStatus.PLAN_WAITING_CONFIRMATION]:
    'PLAN_WAITING_CONFIRMATION',
  [WorkflowRunStatus.PLAN_CONFIRMED]: 'PLAN_CONFIRMED',
  [WorkflowRunStatus.EXECUTION_PENDING]: 'EXECUTION_PENDING',
  [WorkflowRunStatus.EXECUTION_RUNNING]: 'EXECUTION_RUNNING',
  [WorkflowRunStatus.REVIEW_PENDING]: 'REVIEW_PENDING',
  [WorkflowRunStatus.HUMAN_REVIEW_PENDING]:
    'HUMAN_REVIEW_PENDING',
  [WorkflowRunStatus.DONE]: 'DONE',
  [WorkflowRunStatus.FAILED]: 'FAILED',
};

const stageStatusMap: Record<StageExecutionStatus, string> = {
  [StageExecutionStatus.PENDING]: 'PENDING',
  [StageExecutionStatus.RUNNING]: 'RUNNING',
  [StageExecutionStatus.COMPLETED]: 'COMPLETED',
  [StageExecutionStatus.FAILED]: 'FAILED',
  [StageExecutionStatus.WAITING_CONFIRMATION]:
    'WAITING_CONFIRMATION',
  [StageExecutionStatus.REJECTED]: 'REJECTED',
};

const stageTypeMap: Record<StageType, string> = {
  [StageType.REQUIREMENT_INTAKE]: 'REQUIREMENT_INTAKE',
  [StageType.REPOSITORY_GROUNDING]: 'REPOSITORY_GROUNDING',
  [StageType.TASK_SPLIT]: 'TASK_SPLIT',
  [StageType.TECHNICAL_PLAN]: 'TECHNICAL_PLAN',
  [StageType.EXECUTION]: 'EXECUTION',
  [StageType.AI_REVIEW]: 'AI_REVIEW',
  [StageType.HUMAN_REVIEW]: 'HUMAN_REVIEW',
};

type WorkflowNotificationRecipient = {
  flowxUserId: string;
  displayName: string;
  providerOrganizationId?: string | null;
  organizationName?: string | null;
};

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: WorkflowStateMachine,
    private readonly repositorySyncService: RepositorySyncService,
    private readonly dingTalkNotificationService: DingTalkNotificationService,
    @Inject(AI_EXECUTOR) private readonly aiExecutor: AIExecutor,
  ) {}

  async createWorkflowRun(dto: CreateWorkflowRunDto) {
    const requirement = await this.prisma.requirement.findFirstOrThrow({
      where: {
        id: dto.requirementId,
        status: 'ACTIVE',
      },
      include: {
        project: {
          include: {
            workspace: {
              include: {
                repositories: true,
              },
            },
          },
        },
        workspace: {
          include: {
            repositories: true,
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
    const requestedRepositoryIds = Array.from(
      new Set((dto.repositoryIds ?? []).map((value) => value.trim()).filter(Boolean)),
    );
    const workspaceRepositories = requirement.workspace?.repositories ?? [];
    const workspaceRepositoryMap = new Map(
      workspaceRepositories.map((repository) => [repository.id, repository]),
    );
    const defaultRepositories =
      requirement.requirementRepositories.length > 0
        ? requirement.requirementRepositories.map((entry) => entry.repository)
        : workspaceRepositories;
    const selectedRepositories =
      requestedRepositoryIds.length > 0
        ? requestedRepositoryIds.map((repositoryId) => {
            const repository = workspaceRepositoryMap.get(repositoryId);
            if (!repository) {
              throw new NotFoundException('One or more selected repositories do not belong to the requirement workspace.');
            }
            return repository;
          })
        : defaultRepositories;

    const selectedRepositoryIds = new Set(selectedRepositories.map((repository) => repository.id));
    const existingActiveWorkflows = await this.prisma.workflowRun.findMany({
      where: {
        requirementId: dto.requirementId,
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

    const conflictingWorkflow = existingActiveWorkflows.find((workflowRun) =>
      workflowRun.workflowRepositories.some((repository) =>
        repository.repositoryId ? selectedRepositoryIds.has(repository.repositoryId) : false,
      ),
    );

    if (conflictingWorkflow) {
      throw new BadRequestException(
        `该需求已有进行中的工作流 ${conflictingWorkflow.id} 与当前仓库范围冲突，请调整本次仓库选择后再启动。`,
      );
    }

    if (requirement.workspaceId) {
      await this.repositorySyncService.syncWorkspaceRepositories(requirement.workspaceId);
    }

    const workflow = await this.prisma.$transaction(async (tx) => {
      const workflow = await tx.workflowRun.create({
        data: {
          requirementId: dto.requirementId,
          status: 'CREATED',
        },
      });

      if (selectedRepositories.length > 0) {
        const workflowRepositoryRecords = selectedRepositories.map((repository) => ({
          repositoryId: repository.id,
          name: repository.name,
          url: repository.url,
          baseBranch:
            repository.currentBranch?.trim() ||
            repository.defaultBranch?.trim() ||
            'main',
          workingBranch: this.buildWorkflowBranchName(
            requirement.title,
            workflow.id,
            repository.name,
          ),
        }));

        const createdWorkflowRepositories = await Promise.all(
          workflowRepositoryRecords.map((repository) =>
            tx.workflowRepository.create({
              data: {
                workflowRunId: workflow.id,
                repositoryId: repository.repositoryId,
                name: repository.name,
                url: repository.url,
                baseBranch: repository.baseBranch,
                workingBranch: repository.workingBranch,
                status: 'PENDING',
              },
            }),
          ),
        );

        for (const repository of createdWorkflowRepositories) {
          await tx.workflowRepository.update({
            where: { id: repository.id },
            data: {
              localPath: this.repositorySyncService.buildWorkflowRepositoryPath(
                workflow.id,
                repository.id,
                repository.name,
              ),
            },
          });
        }
      }

      return workflow;
    });

    try {
      await this.repositorySyncService.prepareWorkflowRepositories(workflow.id);
    } catch (error) {
      await this.prisma.workflowRun.update({
        where: { id: workflow.id },
        data: {
          status: 'FAILED',
        },
      });
      throw error;
    }

    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.CREATED, {
        to: WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
        stage: StageType.REPOSITORY_GROUNDING,
      });

      await this.createStageExecution(tx, workflow.id, StageType.REPOSITORY_GROUNDING, {
        input: {
          workflowRunId: workflow.id,
          repositories: selectedRepositories.map((repository) => ({
            id: repository.id,
            name: repository.name,
            url: repository.url,
          })),
        },
        status: StageExecutionStatus.RUNNING,
        statusMessage: '正在生成仓库 grounding 上下文',
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id: workflow.id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`grounding:${workflow.id}`, async () => {
      try {
        await this.repositorySyncService.generateWorkflowRepositoryGrounding(workflow.id);
        const groundedWorkflow = await this.getWorkflowOrThrow(workflow.id);
        const groundingOutput = this.buildGroundingStageOutput(groundedWorkflow.workflowRepositories);

        await this.prisma.$transaction(async (tx) => {
          const groundingStage = await tx.stageExecution.findFirstOrThrow({
            where: {
              workflowRunId: workflow.id,
              stage: stageTypeMap[StageType.REPOSITORY_GROUNDING],
              status: 'RUNNING',
            },
            orderBy: { attempt: 'desc' },
          });

          await this.updateStageExecution(
            tx,
            groundingStage.id,
            StageExecutionStatus.COMPLETED,
            {
              output: groundingOutput,
              statusMessage: null,
              finishedAt: new Date(),
            },
          );

          await this.transitionWorkflow(
            tx,
            workflow.id,
            WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
            {
              to: WorkflowRunStatus.TASK_SPLIT_PENDING,
              stage: StageType.TASK_SPLIT,
            },
          );
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Repository grounding failed';
        await this.prisma.$transaction(async (tx) => {
          const groundingStage = await tx.stageExecution.findFirst({
            where: {
              workflowRunId: workflow.id,
              stage: stageTypeMap[StageType.REPOSITORY_GROUNDING],
              status: 'RUNNING',
            },
            orderBy: { attempt: 'desc' },
          });

          if (groundingStage) {
            await this.updateStageExecution(tx, groundingStage.id, StageExecutionStatus.FAILED, {
              errorMessage: message,
              statusMessage: '仓库 grounding 失败，请查看错误信息',
              finishedAt: new Date(),
            });
          }

          await tx.workflowRun.update({
            where: { id: workflow.id },
            data: {
              status: workflowStatusMap[WorkflowRunStatus.FAILED],
              currentStage: stageTypeMap[StageType.REPOSITORY_GROUNDING],
            },
          });
        });
      }
    });

    return startedWorkflow;
  }

  async findAll() {
    return this.prisma.workflowRun.findMany({
      orderBy: { createdAt: 'desc' },
      include: this.workflowInclude(),
    });
  }

  async findOne(id: string) {
    return this.getWorkflowOrThrow(id);
  }

  async deleteWorkflowRun(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    const hasRunningStage = workflow.stageExecutions.some((stage) => stage.status === 'RUNNING');

    if (hasRunningStage) {
      throw new BadRequestException('当前工作流仍有阶段在执行中，请等待完成后再删除。');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.issue.updateMany({
        where: { workflowRunId: id },
        data: { workflowRunId: null },
      });

      await tx.bug.updateMany({
        where: { workflowRunId: id },
        data: { workflowRunId: null },
      });

      await tx.reviewFinding.deleteMany({
        where: { workflowRunId: id },
      });

      await tx.reviewReport.deleteMany({
        where: { workflowRunId: id },
      });

      await tx.codeExecution.deleteMany({
        where: { workflowRunId: id },
      });

      await tx.plan.deleteMany({
        where: { workflowRunId: id },
      });

      await tx.task.deleteMany({
        where: { workflowRunId: id },
      });

      await tx.stageExecution.deleteMany({
        where: { workflowRunId: id },
      });

      await tx.workflowRepository.deleteMany({
        where: { workflowRunId: id },
      });

      await tx.workflowRun.delete({
        where: { id },
      });
    });

    await this.repositorySyncService.removeWorkflowStorage(id);

    return { success: true };
  }

  async getHistory(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    return workflow.stageExecutions;
  }

  async runTaskSplit(
    id: string,
    humanFeedback?: string,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, StageType.TASK_SPLIT);
    const workflowStatus = this.fromPrismaWorkflowStatus(workflow.status);
    if (
      workflowStatus !== WorkflowRunStatus.TASK_SPLIT_PENDING &&
      !(workflowStatus === WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION && humanFeedback)
    ) {
      this.stateMachine.assertStageMatchesWorkflow(StageType.TASK_SPLIT, workflowStatus);
    }

    const requirement = workflow.requirement;
    const recipient = this.toNotificationRecipient(notifyRecipient);
    const previousStage =
      workflow.status === 'TASK_SPLIT_WAITING_CONFIRMATION'
        ? this.getLatestStageOrThrow(workflow, StageType.TASK_SPLIT)
        : null;
    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      if (workflow.status === 'TASK_SPLIT_WAITING_CONFIRMATION') {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION, {
          to: WorkflowRunStatus.TASK_SPLIT_PENDING,
          stage: StageType.TASK_SPLIT,
        });
      }

      const stageExecution = await this.createStageExecution(tx, id, StageType.TASK_SPLIT, {
        input: {
          requirement,
          humanFeedback: humanFeedback ?? null,
          notifier: recipient,
        },
        status: StageExecutionStatus.RUNNING,
        statusMessage: '正在调用 Codex 进行任务拆解',
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`task-split:${id}`, async () => {
      try {
        const splitOutput = await this.aiExecutor.splitTasks({
          requirement: {
            id: requirement.id,
            title: requirement.title,
            description: requirement.description,
            acceptanceCriteria: requirement.acceptanceCriteria,
          },
          workspace: this.buildWorkspaceContext(workflow.requirement.workspace, workflow.workflowRepositories),
          humanFeedback: humanFeedback ?? null,
          previousOutput: (previousStage?.output as SplitTasksOutput | null) ?? null,
        });

        await this.prisma.$transaction(async (tx) => {
          const stageExecution = await tx.stageExecution.findFirstOrThrow({
            where: { workflowRunId: id, stage: stageTypeMap[StageType.TASK_SPLIT], status: 'RUNNING' },
            orderBy: { attempt: 'desc' },
          });

          await tx.task.deleteMany({ where: { workflowRunId: id } });
          await tx.task.createMany({
            data: splitOutput.tasks.map((task, index) => ({
              workflowRunId: id,
              title: task.title,
              description: task.description,
              order: index,
              status: 'DRAFT',
            })),
          });

          await this.updateStageExecution(tx, stageExecution.id, StageExecutionStatus.WAITING_CONFIRMATION, {
            output: splitOutput,
            statusMessage: null,
            finishedAt: new Date(),
          });

          await this.transitionWorkflow(tx, id, WorkflowRunStatus.TASK_SPLIT_PENDING, {
            to: WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION,
            stage: StageType.TASK_SPLIT,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Task split failed';
        await this.markRunningStageFailed(id, StageType.TASK_SPLIT, message);
      }
    });

    return startedWorkflow;
  }

  async confirmTaskSplit(id: string, notifyRecipient?: WorkflowNotificationSession) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'TASK_SPLIT_WAITING_CONFIRMATION') {
      throw new BadRequestException('Task split is not waiting for confirmation.');
    }

    const taskSplitStage = this.getLatestStageOrThrow(workflow, StageType.TASK_SPLIT);
    const updatedWorkflow = await this.prisma.$transaction(async (tx) => {
      await this.updateStageExecution(tx, taskSplitStage.id, StageExecutionStatus.COMPLETED, {
        finishedAt: new Date(),
      });

      await tx.task.updateMany({
        where: { workflowRunId: id },
        data: { status: 'CONFIRMED' },
      });

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION, {
        to: WorkflowRunStatus.TASK_SPLIT_CONFIRMED,
      });
      await this.transitionWorkflow(tx, id, WorkflowRunStatus.TASK_SPLIT_CONFIRMED, {
        to: WorkflowRunStatus.PLAN_PENDING,
        stage: StageType.TECHNICAL_PLAN,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.notifyStageCompleted({
      recipient: this.toNotificationRecipient(notifyRecipient),
      workflowRunId: updatedWorkflow.id,
      requirementTitle: updatedWorkflow.requirement.title,
      stageName: '任务拆解',
      result: '已确认完成',
      nextStep: '可以开始技术方案阶段',
    });

    return updatedWorkflow;
  }

  async rejectTaskSplit(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'TASK_SPLIT_WAITING_CONFIRMATION') {
      throw new BadRequestException('Task split is not waiting for confirmation.');
    }

    const taskSplitStage = this.getLatestStageOrThrow(workflow, StageType.TASK_SPLIT);
    return this.prisma.$transaction(async (tx) => {
      await this.updateStageExecution(tx, taskSplitStage.id, StageExecutionStatus.REJECTED, {
        finishedAt: new Date(),
      });

      await tx.task.updateMany({
        where: { workflowRunId: id },
        data: { status: 'REJECTED' },
      });

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION, {
        to: WorkflowRunStatus.TASK_SPLIT_PENDING,
        stage: StageType.TASK_SPLIT,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  async runPlan(
    id: string,
    humanFeedback?: string,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, StageType.TECHNICAL_PLAN);
    if (
      workflow.status !== 'PLAN_PENDING' &&
      !(workflow.status === 'PLAN_WAITING_CONFIRMATION' && humanFeedback)
    ) {
      throw new BadRequestException('Plan can only run after task split is confirmed.');
    }

    const recipient = this.toNotificationRecipient(notifyRecipient);
    const tasks = workflow.tasks.map((task) => ({
      title: task.title,
      description: task.description,
    }));

    const previousStage =
      workflow.status === 'PLAN_WAITING_CONFIRMATION'
        ? this.getLatestStageOrThrow(workflow, StageType.TECHNICAL_PLAN)
        : null;
    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      if (workflow.status === 'PLAN_WAITING_CONFIRMATION') {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.PLAN_WAITING_CONFIRMATION, {
          to: WorkflowRunStatus.PLAN_PENDING,
          stage: StageType.TECHNICAL_PLAN,
        });
      }

      const planStage = await this.createStageExecution(tx, id, StageType.TECHNICAL_PLAN, {
        input: {
          requirement: workflow.requirement,
          tasks,
          humanFeedback: humanFeedback ?? null,
          notifier: recipient,
        },
        status: StageExecutionStatus.RUNNING,
        statusMessage: '正在调用 Codex 生成技术方案',
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`plan:${id}`, async () => {
      try {
        const rawOutput = await this.aiExecutor.generatePlan({
          requirement: {
            id: workflow.requirement.id,
            title: workflow.requirement.title,
            description: workflow.requirement.description,
            acceptanceCriteria: workflow.requirement.acceptanceCriteria,
          },
          tasks,
          workspace: this.buildWorkspaceContext(workflow.requirement.workspace, workflow.workflowRepositories),
          humanFeedback: humanFeedback ?? null,
          previousOutput: (previousStage?.output as GeneratePlanOutput | null) ?? null,
        });
        const output = this.sanitizePlanOutputPaths(rawOutput, workflow.workflowRepositories);
        this.assertPlanHasConcreteFiles(rawOutput, output);
        await this.assertPlanMatchesRepositories(output, workflow.workflowRepositories);

        await this.prisma.$transaction(async (tx) => {
          const planStage = await tx.stageExecution.findFirstOrThrow({
            where: { workflowRunId: id, stage: stageTypeMap[StageType.TECHNICAL_PLAN], status: 'RUNNING' },
            orderBy: { attempt: 'desc' },
          });

          await tx.plan.upsert({
            where: { workflowRunId: id },
            create: {
              workflowRunId: id,
              status: 'WAITING_HUMAN_CONFIRMATION',
              summary: output.summary,
              implementationPlan: output.implementationPlan,
              filesToModify: output.filesToModify,
              newFiles: output.newFiles,
              riskPoints: output.riskPoints,
            },
            update: {
              status: 'WAITING_HUMAN_CONFIRMATION',
              summary: output.summary,
              implementationPlan: output.implementationPlan,
              filesToModify: output.filesToModify,
              newFiles: output.newFiles,
              riskPoints: output.riskPoints,
            },
          });

          await this.updateStageExecution(tx, planStage.id, StageExecutionStatus.WAITING_CONFIRMATION, {
            output,
            statusMessage: null,
            finishedAt: new Date(),
          });

          await this.transitionWorkflow(tx, id, WorkflowRunStatus.PLAN_PENDING, {
            to: WorkflowRunStatus.PLAN_WAITING_CONFIRMATION,
            stage: StageType.TECHNICAL_PLAN,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Plan failed';
        await this.markRunningStageFailed(id, StageType.TECHNICAL_PLAN, message);
      }
    });

    return startedWorkflow;
  }

  async confirmPlan(id: string, notifyRecipient?: WorkflowNotificationSession) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'PLAN_WAITING_CONFIRMATION') {
      throw new BadRequestException('Plan is not waiting for confirmation.');
    }

    const planStage = this.getLatestStageOrThrow(workflow, StageType.TECHNICAL_PLAN);
    const updatedWorkflow = await this.prisma.$transaction(async (tx) => {
      await this.updateStageExecution(tx, planStage.id, StageExecutionStatus.COMPLETED, {
        finishedAt: new Date(),
      });

      await tx.plan.update({
        where: { workflowRunId: id },
        data: { status: 'CONFIRMED' },
      });

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.PLAN_WAITING_CONFIRMATION, {
        to: WorkflowRunStatus.PLAN_CONFIRMED,
      });
      await this.transitionWorkflow(tx, id, WorkflowRunStatus.PLAN_CONFIRMED, {
        to: WorkflowRunStatus.EXECUTION_PENDING,
        stage: StageType.EXECUTION,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.notifyStageCompleted({
      recipient: this.toNotificationRecipient(notifyRecipient),
      workflowRunId: updatedWorkflow.id,
      requirementTitle: updatedWorkflow.requirement.title,
      stageName: '技术方案',
      result: '已确认完成',
      nextStep: '可以开始执行开发阶段',
    });

    return updatedWorkflow;
  }

  async rejectPlan(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'PLAN_WAITING_CONFIRMATION') {
      throw new BadRequestException('Plan is not waiting for confirmation.');
    }

    const planStage = this.getLatestStageOrThrow(workflow, StageType.TECHNICAL_PLAN);
    return this.prisma.$transaction(async (tx) => {
      await this.updateStageExecution(tx, planStage.id, StageExecutionStatus.REJECTED, {
        finishedAt: new Date(),
      });

      await tx.plan.update({
        where: { workflowRunId: id },
        data: { status: 'REJECTED' },
      });

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.PLAN_WAITING_CONFIRMATION, {
        to: WorkflowRunStatus.PLAN_PENDING,
        stage: StageType.TECHNICAL_PLAN,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  async runExecution(
    id: string,
    humanFeedback?: string,
    trigger?: {
      triggerType?: string;
      findingId?: string;
      findingTitle?: string;
    },
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, StageType.EXECUTION);
    const recipient = this.toNotificationRecipient(notifyRecipient);
    if (
      workflow.status !== 'EXECUTION_PENDING' &&
      !((workflow.status === 'REVIEW_PENDING' || workflow.status === 'HUMAN_REVIEW_PENDING') && humanFeedback)
    ) {
      throw new BadRequestException('Execution can only run after plan confirmation.');
    }
    if (!workflow.plan) {
      throw new NotFoundException('Confirmed plan not found.');
    }
    const confirmedPlan = workflow.plan;

    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      if (workflow.status === 'REVIEW_PENDING' || workflow.status === 'HUMAN_REVIEW_PENDING') {
        await this.transitionWorkflow(tx, id, this.fromPrismaWorkflowStatus(workflow.status), {
          to: WorkflowRunStatus.EXECUTION_PENDING,
          stage: StageType.EXECUTION,
        });
      }
      await this.transitionWorkflow(tx, id, WorkflowRunStatus.EXECUTION_PENDING, {
        to: WorkflowRunStatus.EXECUTION_RUNNING,
        stage: StageType.EXECUTION,
      });

      const executionStage = await this.createStageExecution(tx, id, StageType.EXECUTION, {
        input: {
          requirement: workflow.requirement,
          plan: workflow.plan,
          humanFeedback: humanFeedback ?? null,
          triggerType: trigger?.triggerType ?? null,
          findingId: trigger?.findingId ?? null,
          findingTitle: trigger?.findingTitle ?? null,
          notifier: recipient,
        },
        status: StageExecutionStatus.RUNNING,
        statusMessage:
          trigger?.triggerType === 'review_finding_fix'
            ? '正在根据 AI 审查结果修复代码'
            : '正在调用 Codex 执行开发',
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`execution:${id}`, async () => {
      try {
        const rawOutput = await this.aiExecutor.executeTask({
          requirement: {
            id: workflow.requirement.id,
            title: workflow.requirement.title,
            description: workflow.requirement.description,
            acceptanceCriteria: workflow.requirement.acceptanceCriteria,
          },
          tasks: workflow.tasks.map((task) => ({
            title: task.title,
            description: task.description,
          })),
          plan: {
            summary: confirmedPlan.summary,
            implementationPlan: confirmedPlan.implementationPlan as string[],
            filesToModify: confirmedPlan.filesToModify as string[],
            newFiles: confirmedPlan.newFiles as string[],
            riskPoints: confirmedPlan.riskPoints as string[],
          },
          workspace: this.buildWorkspaceContext(workflow.requirement.workspace, workflow.workflowRepositories),
          humanFeedback: humanFeedback ?? null,
        });
        const output = this.sanitizeExecutionOutputPaths(rawOutput, workflow.workflowRepositories);

        await this.prisma.$transaction(async (tx) => {
          const executionStage = await tx.stageExecution.findFirstOrThrow({
            where: { workflowRunId: id, stage: stageTypeMap[StageType.EXECUTION], status: 'RUNNING' },
            orderBy: { attempt: 'desc' },
          });

          await tx.codeExecution.upsert({
            where: { workflowRunId: id },
            create: {
              workflowRunId: id,
              status: 'WAITING_HUMAN_REVIEW',
              patchSummary: output.patchSummary,
              changedFiles: output.changedFiles,
              codeChanges: output.codeChanges,
              diffArtifacts: output.diffArtifacts,
            },
            update: {
              status: 'WAITING_HUMAN_REVIEW',
              patchSummary: output.patchSummary,
              changedFiles: output.changedFiles,
              codeChanges: output.codeChanges,
              diffArtifacts: output.diffArtifacts,
            },
          });

          await this.updateStageExecution(tx, executionStage.id, StageExecutionStatus.COMPLETED, {
            output,
            statusMessage: null,
            finishedAt: new Date(),
          });

          await this.transitionWorkflow(tx, id, WorkflowRunStatus.EXECUTION_RUNNING, {
            to: WorkflowRunStatus.REVIEW_PENDING,
            stage: StageType.AI_REVIEW,
          });
        });

        this.notifyStageCompleted({
          recipient: this.readNotificationRecipient(startedWorkflow.stageExecutions, StageType.EXECUTION) ?? recipient,
          workflowRunId: workflow.id,
          requirementTitle: workflow.requirement.title,
          stageName: '执行开发',
          result: '已完成',
          nextStep: '可以开始 AI 审查阶段',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Execution failed';
        await this.markRunningStageFailed(id, StageType.EXECUTION, message, WorkflowRunStatus.EXECUTION_PENDING);
      }
    });

    return startedWorkflow;
  }

  async runReview(
    id: string,
    humanFeedback?: string,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, StageType.AI_REVIEW);
    const recipient = this.toNotificationRecipient(notifyRecipient);
    if (
      workflow.status !== 'REVIEW_PENDING' &&
      !(workflow.status === 'HUMAN_REVIEW_PENDING' && humanFeedback)
    ) {
      throw new BadRequestException('Review can only run after execution completes.');
    }
    if (!workflow.plan || !workflow.codeExecution) {
      throw new NotFoundException('Execution context for review is incomplete.');
    }
    const confirmedPlan = workflow.plan;
    const executionResult = workflow.codeExecution;

    const previousStage =
      workflow.status === 'HUMAN_REVIEW_PENDING'
        ? this.getLatestStageOrThrow(workflow, StageType.AI_REVIEW)
        : null;
    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      if (workflow.status === 'HUMAN_REVIEW_PENDING') {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.HUMAN_REVIEW_PENDING, {
          to: WorkflowRunStatus.REVIEW_PENDING,
          stage: StageType.AI_REVIEW,
        });
      }

      const reviewStage = await this.createStageExecution(tx, id, StageType.AI_REVIEW, {
        input: {
          plan: workflow.plan,
          execution: workflow.codeExecution,
          humanFeedback: humanFeedback ?? null,
          notifier: recipient,
        },
        status: StageExecutionStatus.RUNNING,
        statusMessage: '正在调用 Codex 执行 AI 审查',
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`review:${id}`, async () => {
      try {
        const output = await this.aiExecutor.reviewCode({
          requirement: {
            id: workflow.requirement.id,
            title: workflow.requirement.title,
            description: workflow.requirement.description,
            acceptanceCriteria: workflow.requirement.acceptanceCriteria,
          },
          plan: {
            summary: confirmedPlan.summary,
            implementationPlan: confirmedPlan.implementationPlan as string[],
            filesToModify: confirmedPlan.filesToModify as string[],
            newFiles: confirmedPlan.newFiles as string[],
            riskPoints: confirmedPlan.riskPoints as string[],
          },
          execution: {
            patchSummary: executionResult.patchSummary,
            changedFiles: executionResult.changedFiles as string[],
            codeChanges: executionResult.codeChanges as Array<{
              file: string;
              changeType: 'create' | 'update';
              summary: string;
            }>,
            diffArtifacts:
              (executionResult.diffArtifacts as Array<{
                repository: string;
                branch: string;
                localPath: string;
                diffStat: string;
                diffText: string;
                untrackedFiles: string[];
              }>) ?? [],
          },
          workspace: this.buildWorkspaceContext(workflow.requirement.workspace, workflow.workflowRepositories),
          humanFeedback: humanFeedback ?? null,
          previousOutput: (previousStage?.output as ReviewCodeOutput | null) ?? null,
        });

        await this.prisma.$transaction(async (tx) => {
          const reviewStage = await tx.stageExecution.findFirstOrThrow({
            where: { workflowRunId: id, stage: stageTypeMap[StageType.AI_REVIEW], status: 'RUNNING' },
            orderBy: { attempt: 'desc' },
          });

          await tx.reviewReport.upsert({
            where: { workflowRunId: id },
            create: {
              workflowRunId: id,
              status: 'WAITING_HUMAN_REVIEW',
              issues: output.issues,
              bugs: output.bugs,
              missingTests: output.missingTests,
              suggestions: output.suggestions,
              impactScope: output.impactScope,
            },
            update: {
              status: 'WAITING_HUMAN_REVIEW',
              issues: output.issues,
              bugs: output.bugs,
              missingTests: output.missingTests,
              suggestions: output.suggestions,
              impactScope: output.impactScope,
            },
          });

          await this.updateStageExecution(tx, reviewStage.id, StageExecutionStatus.COMPLETED, {
            output,
            statusMessage: null,
            finishedAt: new Date(),
          });

          await this.transitionWorkflow(tx, id, WorkflowRunStatus.REVIEW_PENDING, {
            to: WorkflowRunStatus.HUMAN_REVIEW_PENDING,
            stage: StageType.HUMAN_REVIEW,
          });
        });

        this.notifyStageCompleted({
          recipient: this.readNotificationRecipient(startedWorkflow.stageExecutions, StageType.AI_REVIEW) ?? recipient,
          workflowRunId: workflow.id,
          requirementTitle: workflow.requirement.title,
          stageName: 'AI 审查',
          result: '已完成',
          nextStep: '等待人工审核决策',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Review failed';
        await this.markRunningStageFailed(id, StageType.AI_REVIEW, message);
      }
    });

    return startedWorkflow;
  }

  async fixReviewFinding(
    id: string,
    findingId: string,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'HUMAN_REVIEW_PENDING') {
      throw new BadRequestException('只有在 AI 审查完成后，才能基于审查结果继续修复。');
    }

    const finding = await this.prisma.reviewFinding.findFirst({
      where: {
        id: findingId,
        workflowRunId: id,
      },
    });

    if (!finding) {
      throw new NotFoundException('Review finding not found.');
    }

    return this.runExecution(id, this.buildReviewFindingFixFeedback(finding), {
      triggerType: 'review_finding_fix',
      findingId: finding.id,
      findingTitle: finding.title,
    }, notifyRecipient);
  }

  async publishGitChanges(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'DONE') {
      throw new BadRequestException('只有人工确认通过后的工作流才能提交到远程。');
    }

    const repositories = this.resolvePublishRepositories(workflow);

    if (repositories.length === 0) {
      throw new BadRequestException(
        '当前工作流没有可提交的代码仓库。若这是较早创建的工作流，请重新执行一次开发或新建工作流后再提交。',
      );
    }

    const commitMessage = this.buildWorkflowCommitMessage(workflow);
    const publishedRepositories: Array<{
      repository: string;
      branch: string;
      commitSha: string;
      pushed: boolean;
    }> = [];

    for (const repository of repositories) {
      const cwd = repository.localPath;
      await this.runGit(['checkout', repository.workingBranch], cwd);

      const hasChanges = await this.hasGitChanges(cwd);
      if (!hasChanges) {
        continue;
      }

      await this.runGit(['add', '-A'], cwd);
      await this.runGit(['commit', '-m', commitMessage], cwd);
      const publishBranch = this.buildPublishBranchName(
        workflow.requirement.title,
        workflow.id,
        repository.repository,
      );
      await this.runGit(['checkout', '-B', publishBranch], cwd);
      await this.runGit(['push', '-u', 'origin', publishBranch], cwd);
      await this.runGit(['checkout', repository.workingBranch], cwd);

      publishedRepositories.push({
        repository: repository.repository,
        branch: publishBranch,
        commitSha: await this.getHeadSha(cwd),
        pushed: true,
      });
    }

    if (publishedRepositories.length === 0) {
      throw new BadRequestException('当前工作流没有新的代码改动可提交。');
    }

    return {
      message: commitMessage,
      repositories: publishedRepositories,
    };
  }

  private resolvePublishRepositories(workflow: WorkflowPayload) {
    const workflowRepositories = workflow.workflowRepositories
      .filter((repository) => repository.localPath && repository.status === 'READY')
      .map((repository) => ({
        repository: repository.name,
        workingBranch: repository.workingBranch,
        localPath: repository.localPath as string,
      }));

    if (workflowRepositories.length > 0) {
      return workflowRepositories;
    }

    const legacyArtifacts = Array.isArray(workflow.codeExecution?.diffArtifacts)
      ? (workflow.codeExecution.diffArtifacts as Array<Record<string, unknown>>)
      : [];

    const deduplicated = new Map<
      string,
      { repository: string; workingBranch: string; localPath: string }
    >();

    for (const artifact of legacyArtifacts) {
      const localPath = String(artifact?.localPath ?? '').trim();
      const branch = String(artifact?.branch ?? '').trim();
      const repository = String(artifact?.repository ?? '').trim() || 'repository';

      if (!localPath || !branch) {
        continue;
      }

      const key = `${localPath}::${branch}`;
      if (!deduplicated.has(key)) {
        deduplicated.set(key, {
          repository,
          workingBranch: branch,
          localPath,
        });
      }
    }

    return Array.from(deduplicated.values());
  }

  async decideHumanReview(
    id: string,
    decision: HumanReviewDecision,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'HUMAN_REVIEW_PENDING') {
      throw new BadRequestException('Workflow is not waiting for human review.');
    }

    const nextStatus =
      decision === HumanReviewDecision.ACCEPT || decision === HumanReviewDecision.CONTINUE
        ? WorkflowRunStatus.DONE
        : decision === HumanReviewDecision.REWORK
          ? WorkflowRunStatus.EXECUTION_PENDING
          : WorkflowRunStatus.FAILED;

    const updatedWorkflow = await this.prisma.$transaction(async (tx) => {
      await this.transitionWorkflow(tx, id, WorkflowRunStatus.HUMAN_REVIEW_PENDING, {
        to: nextStatus,
        stage:
          nextStatus === WorkflowRunStatus.EXECUTION_PENDING
            ? StageType.EXECUTION
            : StageType.HUMAN_REVIEW,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.notifyStageCompleted({
      recipient: this.toNotificationRecipient(notifyRecipient),
      workflowRunId: updatedWorkflow.id,
      requirementTitle: updatedWorkflow.requirement.title,
      stageName: '人工审核',
      result: this.describeHumanReviewDecision(decision),
      nextStep:
        nextStatus === WorkflowRunStatus.DONE
          ? '工作流已结束，可按需发布代码'
          : nextStatus === WorkflowRunStatus.EXECUTION_PENDING
            ? '回到执行开发阶段继续处理'
            : '工作流已标记失败',
    });

    return updatedWorkflow;
  }

  async manualEditTaskSplit(id: string, output: Record<string, unknown>) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'TASK_SPLIT_WAITING_CONFIRMATION') {
      throw new BadRequestException('Task split is not waiting for confirmation.');
    }

    const tasks = Array.isArray(output.tasks) ? output.tasks : [];
    const ambiguities = Array.isArray(output.ambiguities) ? output.ambiguities : [];
    const risks = Array.isArray(output.risks) ? output.risks : [];

    return this.prisma.$transaction(async (tx) => {
      const stage = this.getLatestStageOrThrow(workflow, StageType.TASK_SPLIT);
      await tx.task.deleteMany({ where: { workflowRunId: id } });
      await tx.task.createMany({
        data: tasks.map((task, index) => ({
          workflowRunId: id,
          title: String((task as { title?: unknown }).title ?? `Task ${index + 1}`),
          description: String((task as { description?: unknown }).description ?? ''),
          order: index,
          status: 'DRAFT',
        })),
      });
      await this.updateStageExecution(tx, stage.id, StageExecutionStatus.WAITING_CONFIRMATION, {
        input: {
          ...(stage.input as Record<string, unknown> | null),
          manualInterventionAt: new Date().toISOString(),
        },
        output: { tasks, ambiguities, risks },
      });
      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  async manualEditPlan(id: string, output: Record<string, unknown>) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'PLAN_WAITING_CONFIRMATION') {
      throw new BadRequestException('Plan is not waiting for confirmation.');
    }

    const normalized = this.sanitizePlanOutputPaths({
      summary: String(output.summary ?? ''),
      implementationPlan: Array.isArray(output.implementationPlan) ? output.implementationPlan.map(String) : [],
      filesToModify: Array.isArray(output.filesToModify) ? output.filesToModify.map(String) : [],
      newFiles: Array.isArray(output.newFiles) ? output.newFiles.map(String) : [],
      riskPoints: Array.isArray(output.riskPoints) ? output.riskPoints.map(String) : [],
    }, workflow.workflowRepositories);

    return this.prisma.$transaction(async (tx) => {
      const stage = this.getLatestStageOrThrow(workflow, StageType.TECHNICAL_PLAN);
      await tx.plan.update({
        where: { workflowRunId: id },
        data: normalized,
      });
      await this.updateStageExecution(tx, stage.id, StageExecutionStatus.WAITING_CONFIRMATION, {
        input: {
          ...(stage.input as Record<string, unknown> | null),
          manualInterventionAt: new Date().toISOString(),
        },
        output: normalized,
      });
      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  async manualEditExecution(id: string, output: Record<string, unknown>) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'REVIEW_PENDING' && workflow.status !== 'HUMAN_REVIEW_PENDING') {
      throw new BadRequestException('Execution result is not available for manual edit.');
    }

    const normalized = this.sanitizeExecutionOutputPaths({
      patchSummary: String(output.patchSummary ?? ''),
      changedFiles: Array.isArray(output.changedFiles) ? output.changedFiles.map(String) : [],
      codeChanges: Array.isArray(output.codeChanges) ? output.codeChanges : [],
      diffArtifacts: Array.isArray(output.diffArtifacts) ? output.diffArtifacts : [],
    }, workflow.workflowRepositories);

    return this.prisma.$transaction(async (tx) => {
      const stage = this.getLatestStageOrThrow(workflow, StageType.EXECUTION);
      await tx.codeExecution.update({
        where: { workflowRunId: id },
        data: normalized,
      });
      await this.updateStageExecution(tx, stage.id, StageExecutionStatus.COMPLETED, {
        input: {
          ...(stage.input as Record<string, unknown> | null),
          manualInterventionAt: new Date().toISOString(),
        },
        output: normalized,
      });
      if (workflow.status === 'HUMAN_REVIEW_PENDING') {
        await tx.reviewReport.deleteMany({ where: { workflowRunId: id } });
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.HUMAN_REVIEW_PENDING, {
          to: WorkflowRunStatus.REVIEW_PENDING,
          stage: StageType.AI_REVIEW,
        });
      }
      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  async manualEditReview(id: string, output: Record<string, unknown>) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'HUMAN_REVIEW_PENDING') {
      throw new BadRequestException('Review is not waiting for human review.');
    }

    const normalized = {
      issues: Array.isArray(output.issues) ? output.issues.map(String) : [],
      bugs: Array.isArray(output.bugs) ? output.bugs.map(String) : [],
      missingTests: Array.isArray(output.missingTests) ? output.missingTests.map(String) : [],
      suggestions: Array.isArray(output.suggestions) ? output.suggestions.map(String) : [],
      impactScope: Array.isArray(output.impactScope) ? output.impactScope.map(String) : [],
    };

    return this.prisma.$transaction(async (tx) => {
      const stage = this.getLatestStageOrThrow(workflow, StageType.AI_REVIEW);
      await tx.reviewReport.update({
        where: { workflowRunId: id },
        data: normalized,
      });
      await this.updateStageExecution(tx, stage.id, StageExecutionStatus.COMPLETED, {
        input: {
          ...(stage.input as Record<string, unknown> | null),
          manualInterventionAt: new Date().toISOString(),
        },
        output: normalized,
      });
      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  private workflowInclude() {
    return {
      requirement: {
        include: {
          project: {
            include: {
              workspace: true,
            },
          },
          workspace: {
            include: {
              repositories: true,
            },
          },
        },
      },
      stageExecutions: {
        orderBy: {
          createdAt: 'asc' as const,
        },
      },
      tasks: {
        orderBy: {
          order: 'asc' as const,
        },
      },
      plan: true,
      codeExecution: true,
      reviewReport: true,
      reviewFindings: {
        orderBy: [{ createdAt: 'asc' as const }, { sourceIndex: 'asc' as const }],
      },
      workflowRepositories: {
        orderBy: {
          createdAt: 'asc' as const,
        },
      },
    };
  }

  private buildWorkspaceContext(workspace: WorkflowPayload['requirement']['workspace'], workflowRepositories?: WorkflowPayload['workflowRepositories']) {
    if (!workspace) {
      return null;
    }

    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      repositories:
        workflowRepositories && workflowRepositories.length > 0
          ? workflowRepositories.map((repository) => ({
              id: repository.repositoryId ?? repository.id,
              name: repository.name,
              url: repository.url,
              defaultBranch: repository.baseBranch,
              currentBranch: repository.workingBranch,
              localPath: repository.localPath,
              syncStatus: repository.status,
              contextSnapshot:
                (repository.contextSnapshot as {
                  strategy?: string;
                  summary?: string;
                  evidenceFiles?: string[];
                } | null) ?? null,
            }))
          : workspace.repositories.map((repository) => ({
              id: repository.id,
              name: repository.name,
              url: repository.url,
              defaultBranch: repository.defaultBranch,
              currentBranch: repository.currentBranch,
              localPath: repository.localPath,
              syncStatus: repository.syncStatus,
              contextSnapshot: null,
            })),
    };
  }

  private buildGroundingStageOutput(
    workflowRepositories: WorkflowPayload['workflowRepositories'],
  ) {
    return {
      repositories: workflowRepositories.map((repository) => ({
        id: repository.id,
        repositoryId: repository.repositoryId,
        name: repository.name,
        url: repository.url,
        baseBranch: repository.baseBranch,
        workingBranch: repository.workingBranch,
        localPath: repository.localPath,
        status: repository.status,
        contextSnapshot:
          (repository.contextSnapshot as {
            strategy?: string;
            summary?: string;
            evidenceFiles?: string[];
          } | null) ?? null,
      })),
    };
  }

  private sanitizePlanOutputPaths(
    output: GeneratePlanOutput,
    repositories?: WorkflowPayload['workflowRepositories'],
  ): GeneratePlanOutput {
    return {
      ...output,
      filesToModify: this.sanitizeFileReferenceList(output.filesToModify, repositories),
      newFiles: this.sanitizeFileReferenceList(output.newFiles, repositories),
    };
  }

  private assertPlanHasConcreteFiles(
    rawOutput: GeneratePlanOutput,
    output: GeneratePlanOutput,
  ) {
    const rawFilesToModify = rawOutput.filesToModify.filter((item) => item.trim().length > 0);
    const rawNewFiles = rawOutput.newFiles.filter((item) => item.trim().length > 0);
    const filesToModify = output.filesToModify.filter((item) => item.trim().length > 0);
    const newFiles = output.newFiles.filter((item) => item.trim().length > 0);

    if (filesToModify.length > 0 || newFiles.length > 0) {
      return;
    }

    if (rawFilesToModify.length > 0 || rawNewFiles.length > 0) {
      throw new Error(
        [
          '技术方案原始输出包含文件落点，但经过路径清洗后为空。',
          `raw filesToModify: ${rawFilesToModify.join('，') || '无'}`,
          `raw newFiles: ${rawNewFiles.join('，') || '无'}`,
          `sanitized filesToModify: ${filesToModify.join('，') || '无'}`,
          `sanitized newFiles: ${newFiles.join('，') || '无'}`,
          '请检查模型是否输出了绝对路径、FlowX 工作目录路径，或非仓库相对路径。',
        ].join(' '),
      );
    }

    throw new Error(
      [
        '技术方案未给出任何明确文件落点。',
        `raw filesToModify: ${rawFilesToModify.join('，') || '无'}`,
        `raw newFiles: ${rawNewFiles.join('，') || '无'}`,
        '请基于当前 workflow 仓库副本的实时结构，输出至少一个 filesToModify 或 newFiles 项后再继续。',
      ].join(' '),
    );
  }

  private async assertPlanMatchesRepositories(
    output: GeneratePlanOutput,
    repositories?: WorkflowPayload['workflowRepositories'],
  ) {
    const invalidFilesToModify: string[] = [];
    const invalidNewFiles: string[] = [];

    for (const file of output.filesToModify) {
      if (!(await this.planPathExistsInRepositories(file, repositories, false))) {
        invalidFilesToModify.push(file);
      }
    }

    for (const file of output.newFiles) {
      if (!(await this.planPathExistsInRepositories(file, repositories, true))) {
        invalidNewFiles.push(file);
      }
    }

    if (invalidFilesToModify.length === 0 && invalidNewFiles.length === 0) {
      return;
    }

    const repositorySummaries = (repositories ?? [])
      .map((repository) => {
        const label = repository.name;
        const branch = repository.workingBranch ?? repository.baseBranch ?? '未设置';
        const localPath = repository.localPath ?? '未提供';
        return `${label}(${branch}) => ${localPath}`;
      })
      .join(' | ');

    const parts = ['技术方案与真实仓库结构不匹配。'];
    if (invalidFilesToModify.length > 0) {
      parts.push(`filesToModify 中这些路径不存在：${invalidFilesToModify.join('，')}`);
    }
    if (invalidNewFiles.length > 0) {
      parts.push(`newFiles 中这些路径的父目录不存在：${invalidNewFiles.join('，')}`);
    }
    parts.push(`当前 workflow 仓库：${repositorySummaries || '无可用仓库'}`);
    parts.push('请重新生成技术方案，并严格基于仓库真实目录结构。');

    throw new Error(parts.join(' '));
  }

  private async planPathExistsInRepositories(
    value: string,
    repositories: WorkflowPayload['workflowRepositories'] | undefined,
    allowParentDirectory: boolean,
  ) {
    const candidates = this.resolveRepositoryPathCandidates(value, repositories, allowParentDirectory);

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private resolveRepositoryPathCandidates(
    value: string,
    repositories: WorkflowPayload['workflowRepositories'] | undefined,
    allowParentDirectory: boolean,
  ) {
    const normalized = String(value ?? '').trim().replace(/\\/g, '/');
    if (!normalized) {
      return [];
    }

    const availableRepositories = (repositories ?? []).filter((repository) => repository.localPath);
    const hasExplicitRepository = normalized.includes(':');

    if (hasExplicitRepository) {
      const [repositoryName, ...rest] = normalized.split(':');
      const relativePath = rest.join(':').replace(/^\/+/, '');
      const matchedRepository = availableRepositories.find((repository) => repository.name === repositoryName);
      if (!matchedRepository?.localPath || !relativePath) {
        return [];
      }

      const targetPath = join(matchedRepository.localPath, relativePath);
      return [allowParentDirectory ? dirname(targetPath) : targetPath];
    }

    return availableRepositories
      .map((repository) => {
        const targetPath = join(repository.localPath!, normalized);
        return allowParentDirectory ? dirname(targetPath) : targetPath;
      });
  }

  private sanitizeExecutionOutputPaths(
    output: {
      patchSummary: string;
      changedFiles: string[];
      codeChanges: Array<{ file: string; changeType: 'create' | 'update'; summary: string }>;
      diffArtifacts: Array<{
        repository: string;
        branch: string;
        localPath: string;
        diffStat: string;
        diffText: string;
        untrackedFiles: string[];
      }>;
    },
    repositories?: WorkflowPayload['workflowRepositories'],
  ) {
    return {
      ...output,
      changedFiles: this.sanitizeFileReferenceList(output.changedFiles, repositories),
      codeChanges: output.codeChanges
        .map((item) => {
          const file = this.normalizeRepositoryFileReference(item.file, repositories);
          return file ? { ...item, file } : null;
        })
        .filter(Boolean) as Array<{ file: string; changeType: 'create' | 'update'; summary: string }>,
      diffArtifacts: output.diffArtifacts.map((artifact) => ({
        ...artifact,
        localPath: '',
        untrackedFiles: this.sanitizeFileReferenceList(artifact.untrackedFiles, repositories),
      })),
    };
  }

  private buildReviewFindingFixFeedback(finding: {
    type: string;
    severity: string;
    title: string;
    description: string;
    recommendation?: string | null;
    impactScope?: Prisma.JsonValue;
  }) {
    const lines = [
      '请基于当前工作流已经确认的任务、方案、代码上下文和工作分支，继续修复下面这条 AI 审查结果。',
      `类型：${finding.type}`,
      `严重级别：${finding.severity}`,
      `标题：${finding.title}`,
      `问题描述：${finding.description}`,
    ];

    if (finding.recommendation?.trim()) {
      lines.push(`建议：${finding.recommendation.trim()}`);
    }

    if (Array.isArray(finding.impactScope) && finding.impactScope.length > 0) {
      lines.push(`影响范围：${finding.impactScope.map(String).join('，')}`);
    }

    lines.push('要求：仅在当前 workflow 的工作分支中做增量修复，尽量最小改动解决该问题，不要处理无关事项。');
    lines.push('修复完成后更新执行结果，但不要自动发起新的 AI 审查。');

    return lines.join('\n');
  }

  private buildWorkflowCommitMessage(workflow: WorkflowPayload) {
    const normalizedTitle = workflow.requirement.title
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[:\r\n]+/g, ' ')
      .slice(0, 60);
    const prefix =
      workflow.reviewFindings.some((finding) => finding.type === 'BUG') ||
      (Array.isArray(workflow.reviewReport?.bugs) && workflow.reviewReport.bugs.length > 0)
        ? 'fix'
        : 'feat';
    const scope = this.resolveCommitScope(workflow);

    return `${prefix}(${scope}): [flowx-ai] ${normalizedTitle || 'workflow update'}`;
  }

  private resolveCommitScope(workflow: WorkflowPayload) {
    const changedFiles = Array.isArray(workflow.codeExecution?.changedFiles)
      ? workflow.codeExecution.changedFiles
      : [];
    const filesToModify = Array.isArray(workflow.plan?.filesToModify)
      ? workflow.plan.filesToModify
      : [];
    const newFiles = Array.isArray(workflow.plan?.newFiles)
      ? workflow.plan.newFiles
      : [];

    const candidates = [
      ...changedFiles,
      ...filesToModify,
      ...newFiles,
    ].map((item) => String(item));

    for (const value of candidates) {
      const normalized = value.replace(/\\/g, '/');
      if (normalized.includes('/admin-app/') || normalized.includes('apps/admin-app/')) {
        return 'admin-app';
      }
      if (normalized.includes('/main-app/') || normalized.includes('apps/main-app/')) {
        return 'main-app';
      }
      if (normalized.includes('/mobile-app/') || normalized.includes('apps/mobile-app/')) {
        return 'mobile-app';
      }
      if (normalized.includes('/rk-bridge/') || normalized.includes('packages/rk-bridge/')) {
        return 'rk-bridge';
      }
    }

    return 'global';
  }

  private sanitizeFileReferenceList(
    values: string[],
    repositories?: WorkflowPayload['workflowRepositories'],
  ) {
    return values
      .map((value) => this.normalizeRepositoryFileReference(value, repositories))
      .filter((value): value is string => value !== null && value.trim().length > 0);
  }

  private normalizeRepositoryFileReference(
    value: string,
    repositories?: WorkflowPayload['workflowRepositories'],
  ): string | null {
    const text = String(value ?? '').trim();
    if (!text) {
      return '';
    }

    const normalizedText = text.replace(/\\/g, '/');
    const normalizedAppRoot = process.cwd().replace(/\\/g, '/');
    const repositoryContexts = (repositories ?? [])
      .filter((repository) => repository.localPath)
      .map((repository) => ({
        name: repository.name,
        localPath: String(repository.localPath).replace(/\\/g, '/').replace(/\/+$/, ''),
      }))
      .sort((a, b) => b.localPath.length - a.localPath.length);

    for (const repository of repositoryContexts) {
      if (normalizedText === repository.localPath || normalizedText.startsWith(`${repository.localPath}/`)) {
        const relativePath = normalizedText.slice(repository.localPath.length).replace(/^\/+/, '');
        if (!relativePath) {
          return repositoryContexts.length > 1 ? `${repository.name}:.` : '.';
        }
        return repositoryContexts.length > 1 ? `${repository.name}:${relativePath}` : relativePath;
      }
    }

    if (
      normalizedText === normalizedAppRoot ||
      normalizedText.startsWith(`${normalizedAppRoot}/`) ||
      normalizedText.includes(`${normalizedAppRoot}/`)
    ) {
      return null;
    }

    return text.split(sep).join('/');
  }

  private async getWorkflowOrThrow(id: string) {
    return this.prisma.workflowRun.findUniqueOrThrow({
      where: { id },
      include: this.workflowInclude(),
    });
  }

  private getLatestStageOrThrow(workflow: WorkflowPayload, stage: StageType) {
    const result = workflow.stageExecutions
      .filter((item) => item.stage === stageTypeMap[stage])
      .sort((a, b) => b.attempt - a.attempt)[0];
    if (!result) {
      throw new NotFoundException(`Stage ${stage} has no execution yet.`);
    }
    return result;
  }

  private assertStageNotRunning(workflow: WorkflowPayload, stage: StageType) {
    const runningStage = workflow.stageExecutions
      .filter((item) => item.stage === stageTypeMap[stage])
      .sort((a, b) => b.attempt - a.attempt)[0];

    if (runningStage?.status === 'RUNNING') {
      throw new BadRequestException('当前阶段正在执行，请等待完成后再试。');
    }
  }

  private async transitionWorkflow(
    tx: Prisma.TransactionClient,
    workflowId: string,
    from: WorkflowRunStatus,
    transition: { to: WorkflowRunStatus; stage?: StageType },
  ) {
    this.stateMachine.assertWorkflowTransition(from, transition.to);
    await tx.workflowRun.update({
      where: { id: workflowId },
      data: {
        status: workflowStatusMap[transition.to],
        currentStage: transition.stage ? stageTypeMap[transition.stage] : undefined,
      },
    });
  }

  private async createStageExecution(
    tx: Prisma.TransactionClient,
    workflowRunId: string,
    stage: StageType,
    data: {
      input?: unknown;
      output?: unknown;
      errorMessage?: string | null;
      statusMessage?: string | null;
      status: StageExecutionStatus;
      startedAt?: Date | null;
      finishedAt?: Date | null;
    },
  ) {
    const latest = await tx.stageExecution.findFirst({
      where: {
        workflowRunId,
        stage: stageTypeMap[stage],
      },
      orderBy: {
        attempt: 'desc',
      },
    });

    return tx.stageExecution.create({
      data: {
        workflowRunId,
        stage: stageTypeMap[stage],
        attempt: (latest?.attempt ?? 0) + 1,
        status: stageStatusMap[data.status],
        statusMessage: data.statusMessage,
        input:
          data.input as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined,
        output:
          data.output as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined,
        errorMessage: data.errorMessage,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
      },
    });
  }

  private async updateStageExecution(
    tx: Prisma.TransactionClient,
    stageExecutionId: string,
    to: StageExecutionStatus,
    extras: {
      input?: unknown;
      output?: unknown;
      errorMessage?: string | null;
      statusMessage?: string | null;
      startedAt?: Date | null;
      finishedAt?: Date | null;
    },
  ) {
    const current = await tx.stageExecution.findUniqueOrThrow({
      where: { id: stageExecutionId },
    });

    this.stateMachine.assertStageTransition(
      this.fromPrismaStageStatus(current.status),
      to,
    );

    await tx.stageExecution.update({
      where: { id: stageExecutionId },
      data: {
        status: stageStatusMap[to],
        statusMessage: extras.statusMessage,
        input:
          extras.input as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined,
        output:
          extras.output as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined,
        errorMessage: extras.errorMessage,
        startedAt: extras.startedAt,
        finishedAt: extras.finishedAt,
      },
    });
  }

  private fromPrismaWorkflowStatus(status: string): WorkflowRunStatus {
    const entry = Object.entries(workflowStatusMap).find(([, value]) => value === status);
    if (!entry) {
      throw new BadRequestException(`Unsupported workflow status: ${status}`);
    }
    return entry[0] as WorkflowRunStatus;
  }

  private fromPrismaStageStatus(status: string): StageExecutionStatus {
    const entry = Object.entries(stageStatusMap).find(([, value]) => value === status);
    if (!entry) {
      throw new BadRequestException(`Unsupported stage status: ${status}`);
    }
    return entry[0] as StageExecutionStatus;
  }

  private buildWorkflowBranchName(requirementTitle: string, workflowId: string, repositoryName: string) {
    const slug = this.slugify(requirementTitle).slice(0, 24) || 'workflow';
    return `flowx/work/${slug}/${workflowId.slice(-8)}`;
  }

  private buildPublishBranchName(requirementTitle: string, workflowId: string, repositoryName: string) {
    const requirementSlug = this.slugify(requirementTitle).slice(0, 24) || 'workflow';
    const repositorySlug = this.slugify(repositoryName).slice(0, 16) || 'repo';
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');

    return `flowx/publish/${requirementSlug}/${workflowId.slice(-8)}-${repositorySlug}-${timestamp}`;
  }

  private slugify(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private runInBackground(taskName: string, job: () => Promise<void>) {
    setTimeout(() => {
      void job().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`${taskName} failed: ${message}`);
      });
    }, 0);
  }

  private notifyStageCompleted(input: {
    recipient?: WorkflowNotificationRecipient | null;
    workflowRunId: string;
    requirementTitle: string;
    stageName: string;
    result: string;
    nextStep?: string | null;
    detail?: string | null;
  }) {
    this.runInBackground(`notify:${input.workflowRunId}:${input.stageName}`, async () => {
      await this.dingTalkNotificationService.notifyStageCompleted(input);
    });
  }

  private describeHumanReviewDecision(decision: HumanReviewDecision) {
    switch (decision) {
      case HumanReviewDecision.ACCEPT:
        return '已通过';
      case HumanReviewDecision.CONTINUE:
        return '已继续放行';
      case HumanReviewDecision.REWORK:
        return '已打回重做';
      case HumanReviewDecision.ROLLBACK:
        return '已回滚终止';
      default:
        return decision;
    }
  }

  private toNotificationRecipient(
    session?: WorkflowNotificationSession,
  ): WorkflowNotificationRecipient | null {
    if (!session?.user?.id) {
      return null;
    }

    return {
      flowxUserId: session.user.id,
      displayName: session.user.displayName,
      providerOrganizationId: session.organization?.providerOrganizationId ?? null,
      organizationName: session.organization?.name ?? null,
    };
  }

  private readNotificationRecipient(
    stageExecutions: WorkflowPayload['stageExecutions'],
    stage: StageType,
  ): WorkflowNotificationRecipient | null {
    const latestStage = stageExecutions
      .filter((item) => item.stage === stageTypeMap[stage])
      .sort((a, b) => b.attempt - a.attempt)[0];

    if (!latestStage?.input || typeof latestStage.input !== 'object' || Array.isArray(latestStage.input)) {
      return null;
    }

    const notifier = (latestStage.input as Record<string, unknown>).notifier;
    if (!notifier || typeof notifier !== 'object' || Array.isArray(notifier)) {
      return null;
    }

    const candidate = notifier as Record<string, unknown>;
    const flowxUserId =
      typeof candidate.flowxUserId === 'string' ? candidate.flowxUserId.trim() : '';
    const displayName =
      typeof candidate.displayName === 'string' ? candidate.displayName.trim() : '';

    if (!flowxUserId || !displayName) {
      return null;
    }

    return {
      flowxUserId,
      displayName,
      providerOrganizationId:
        typeof candidate.providerOrganizationId === 'string'
          ? candidate.providerOrganizationId
          : null,
      organizationName:
        typeof candidate.organizationName === 'string'
          ? candidate.organizationName
          : null,
    };
  }

  private async runGit(args: string[], cwd: string) {
    const { stdout, stderr } = await execFile('git', args, {
      cwd,
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  }

  private async hasGitChanges(cwd: string) {
    const { stdout } = await this.runGit(['status', '--porcelain'], cwd);
    return stdout.length > 0;
  }

  private async getHeadSha(cwd: string) {
    const { stdout } = await this.runGit(['rev-parse', 'HEAD'], cwd);
    return stdout;
  }

  private async markRunningStageFailed(
    workflowId: string,
    stage: StageType,
    message: string,
    rollbackWorkflowStatus?: WorkflowRunStatus,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const runningStage = await tx.stageExecution.findFirst({
        where: {
          workflowRunId: workflowId,
          stage: stageTypeMap[stage],
          status: 'RUNNING',
        },
        orderBy: {
          attempt: 'desc',
        },
      });

      if (!runningStage) {
        return;
      }

      await this.updateStageExecution(tx, runningStage.id, StageExecutionStatus.FAILED, {
        errorMessage: message,
        statusMessage: '执行失败，请查看错误信息后重试',
        finishedAt: new Date(),
      });

      const workflow = await tx.workflowRun.findUniqueOrThrow({
        where: { id: workflowId },
      });

      if (
        rollbackWorkflowStatus &&
        workflow.status === workflowStatusMap[WorkflowRunStatus.EXECUTION_RUNNING]
      ) {
        await this.transitionWorkflow(
          tx,
          workflowId,
          WorkflowRunStatus.EXECUTION_RUNNING,
          {
            to: rollbackWorkflowStatus,
            stage,
          },
        );
      }
    });
  }
}

type WorkflowPayload = Prisma.WorkflowRunGetPayload<{
  include: {
    requirement: {
      include: {
        workspace: {
          include: {
            repositories: true;
          };
        };
      };
    };
    stageExecutions: true;
    tasks: true;
    plan: true;
    codeExecution: true;
    reviewReport: true;
    reviewFindings: true;
    workflowRepositories: true;
  };
}>;

type WorkflowNotificationSession = {
  user: {
    id: string;
    displayName: string;
  };
  organization?: {
    providerOrganizationId?: string | null;
    name?: string | null;
  } | null;
};
