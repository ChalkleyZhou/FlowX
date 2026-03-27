import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { PrismaService } from '../prisma/prisma.service';
import { RepositorySyncService } from '../workspaces/repository-sync.service';
import { CreateWorkflowRunDto } from './dto/create-workflow-run.dto';

const workflowStatusMap: Record<WorkflowRunStatus, string> = {
  [WorkflowRunStatus.CREATED]: 'CREATED',
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
  [StageType.TASK_SPLIT]: 'TASK_SPLIT',
  [StageType.TECHNICAL_PLAN]: 'TECHNICAL_PLAN',
  [StageType.EXECUTION]: 'EXECUTION',
  [StageType.AI_REVIEW]: 'AI_REVIEW',
  [StageType.HUMAN_REVIEW]: 'HUMAN_REVIEW',
};

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: WorkflowStateMachine,
    private readonly repositorySyncService: RepositorySyncService,
    @Inject(AI_EXECUTOR) private readonly aiExecutor: AIExecutor,
  ) {}

  async createWorkflowRun(dto: CreateWorkflowRunDto) {
    const requirement = await this.prisma.requirement.findFirstOrThrow({
      where: {
        id: dto.requirementId,
        status: 'ACTIVE',
      },
      include: {
        workspace: {
          include: {
            repositories: true,
          },
        },
      },
    });

    const existingActiveWorkflow = await this.prisma.workflowRun.findFirst({
      where: {
        requirementId: dto.requirementId,
        status: {
          notIn: ['DONE', 'FAILED'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (existingActiveWorkflow) {
      throw new BadRequestException(
        `该需求已有进行中的工作流：${existingActiveWorkflow.id}，请先完成或终止后再新建。`,
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

      const repositories = requirement.workspace?.repositories ?? [];
      if (repositories.length > 0) {
        const workflowRepositoryRecords = repositories.map((repository) => ({
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

    await this.prisma.$transaction(async (tx) => {
      await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.CREATED, {
        to: WorkflowRunStatus.TASK_SPLIT_PENDING,
        stage: StageType.TASK_SPLIT,
      });
    });

    return this.prisma.workflowRun.findUniqueOrThrow({
      where: { id: workflow.id },
      include: this.workflowInclude(),
    });
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

  async getHistory(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    return workflow.stageExecutions;
  }

  async runTaskSplit(id: string, humanFeedback?: string) {
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

  async confirmTaskSplit(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'TASK_SPLIT_WAITING_CONFIRMATION') {
      throw new BadRequestException('Task split is not waiting for confirmation.');
    }

    const taskSplitStage = this.getLatestStageOrThrow(workflow, StageType.TASK_SPLIT);
    return this.prisma.$transaction(async (tx) => {
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

  async runPlan(id: string, humanFeedback?: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, StageType.TECHNICAL_PLAN);
    if (
      workflow.status !== 'PLAN_PENDING' &&
      !(workflow.status === 'PLAN_WAITING_CONFIRMATION' && humanFeedback)
    ) {
      throw new BadRequestException('Plan can only run after task split is confirmed.');
    }

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
        const output = await this.aiExecutor.generatePlan({
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

  async confirmPlan(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'PLAN_WAITING_CONFIRMATION') {
      throw new BadRequestException('Plan is not waiting for confirmation.');
    }

    const planStage = this.getLatestStageOrThrow(workflow, StageType.TECHNICAL_PLAN);
    return this.prisma.$transaction(async (tx) => {
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

  async runExecution(id: string, humanFeedback?: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, StageType.EXECUTION);
    if (
      workflow.status !== 'EXECUTION_PENDING' &&
      !(workflow.status === 'REVIEW_PENDING' && humanFeedback)
    ) {
      throw new BadRequestException('Execution can only run after plan confirmation.');
    }
    if (!workflow.plan) {
      throw new NotFoundException('Confirmed plan not found.');
    }
    const confirmedPlan = workflow.plan;

    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      if (workflow.status === 'REVIEW_PENDING') {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.REVIEW_PENDING, {
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
        },
        status: StageExecutionStatus.RUNNING,
        statusMessage: '正在调用 Codex 执行开发',
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`execution:${id}`, async () => {
      try {
        const output = await this.aiExecutor.executeTask({
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
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Execution failed';
        await this.markRunningStageFailed(id, StageType.EXECUTION, message, WorkflowRunStatus.EXECUTION_PENDING);
      }
    });

    return startedWorkflow;
  }

  async runReview(id: string, humanFeedback?: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, StageType.AI_REVIEW);
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
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Review failed';
        await this.markRunningStageFailed(id, StageType.AI_REVIEW, message);
      }
    });

    return startedWorkflow;
  }

  async decideHumanReview(id: string, decision: HumanReviewDecision) {
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

    return this.prisma.$transaction(async (tx) => {
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

    const normalized = {
      summary: String(output.summary ?? ''),
      implementationPlan: Array.isArray(output.implementationPlan) ? output.implementationPlan.map(String) : [],
      filesToModify: Array.isArray(output.filesToModify) ? output.filesToModify.map(String) : [],
      newFiles: Array.isArray(output.newFiles) ? output.newFiles.map(String) : [],
      riskPoints: Array.isArray(output.riskPoints) ? output.riskPoints.map(String) : [],
    };

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

    const normalized = {
      patchSummary: String(output.patchSummary ?? ''),
      changedFiles: Array.isArray(output.changedFiles) ? output.changedFiles.map(String) : [],
      codeChanges: Array.isArray(output.codeChanges) ? output.codeChanges : [],
      diffArtifacts: Array.isArray(output.diffArtifacts) ? output.diffArtifacts : [],
    };

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
            }))
          : workspace.repositories.map((repository) => ({
              id: repository.id,
              name: repository.name,
              url: repository.url,
              defaultBranch: repository.defaultBranch,
              currentBranch: repository.currentBranch,
              localPath: repository.localPath,
              syncStatus: repository.syncStatus,
            })),
    };
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
    const slug = `${requirementTitle}-${repositoryName}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36);

    return `ai/${slug || 'workflow'}-${workflowId.slice(-8)}`;
  }

  private runInBackground(taskName: string, job: () => Promise<void>) {
    setTimeout(() => {
      void job().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`${taskName} failed: ${message}`);
      });
    }, 0);
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
    workflowRepositories: true;
  };
}>;
