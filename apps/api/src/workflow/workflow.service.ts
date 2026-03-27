import {
  BadRequestException,
  Inject,
  Injectable,
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

    if (requirement.workspaceId) {
      await this.repositorySyncService.syncWorkspaceRepositories(requirement.workspaceId);
    }

    return this.prisma.$transaction(async (tx) => {
      const workflow = await tx.workflowRun.create({
        data: {
          requirementId: dto.requirementId,
          status: 'CREATED',
        },
      });

      await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.CREATED, {
        to: WorkflowRunStatus.TASK_SPLIT_PENDING,
        stage: StageType.TASK_SPLIT,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id: workflow.id },
        include: this.workflowInclude(),
      });
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

  async runTaskSplit(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.stateMachine.assertStageMatchesWorkflow(
      StageType.TASK_SPLIT,
      this.fromPrismaWorkflowStatus(workflow.status),
    );

    const requirement = workflow.requirement;
    const splitOutput = await this.aiExecutor.splitTasks({
      requirement: {
        id: requirement.id,
        title: requirement.title,
        description: requirement.description,
        acceptanceCriteria: requirement.acceptanceCriteria,
      },
      workspace: this.buildWorkspaceContext(requirement.workspace),
    });

    return this.prisma.$transaction(async (tx) => {
      const stageExecution = await this.createStageExecution(tx, id, StageType.TASK_SPLIT, {
        input: requirement,
        status: StageExecutionStatus.RUNNING,
        startedAt: new Date(),
      });

      await tx.task.deleteMany({
        where: {
          workflowRunId: id,
        },
      });

      await tx.task.createMany({
        data: splitOutput.tasks.map((task, index) => ({
          workflowRunId: id,
          title: task.title,
          description: task.description,
          order: index,
          status: 'DRAFT',
        })),
      });

      await this.updateStageExecution(
        tx,
        stageExecution.id,
        StageExecutionStatus.WAITING_CONFIRMATION,
        {
          output: splitOutput,
          finishedAt: new Date(),
        },
      );

      await this.transitionWorkflow(
        tx,
        id,
        this.fromPrismaWorkflowStatus(workflow.status),
        {
          to: WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION,
          stage: StageType.TASK_SPLIT,
        },
      );

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
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

  async runPlan(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'PLAN_PENDING') {
      throw new BadRequestException('Plan can only run after task split is confirmed.');
    }

    const tasks = workflow.tasks.map((task) => ({
      title: task.title,
      description: task.description,
    }));

    const output = await this.aiExecutor.generatePlan({
      requirement: {
        id: workflow.requirement.id,
        title: workflow.requirement.title,
        description: workflow.requirement.description,
        acceptanceCriteria: workflow.requirement.acceptanceCriteria,
      },
      tasks,
      workspace: this.buildWorkspaceContext(workflow.requirement.workspace),
    });

    return this.prisma.$transaction(async (tx) => {
      const planStage = await this.createStageExecution(tx, id, StageType.TECHNICAL_PLAN, {
        input: {
          requirement: workflow.requirement,
          tasks,
        },
        status: StageExecutionStatus.RUNNING,
        startedAt: new Date(),
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

      await this.updateStageExecution(
        tx,
        planStage.id,
        StageExecutionStatus.WAITING_CONFIRMATION,
        {
          output,
          finishedAt: new Date(),
        },
      );

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.PLAN_PENDING, {
        to: WorkflowRunStatus.PLAN_WAITING_CONFIRMATION,
        stage: StageType.TECHNICAL_PLAN,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
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

  async runExecution(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'EXECUTION_PENDING') {
      throw new BadRequestException('Execution can only run after plan confirmation.');
    }
    if (!workflow.plan) {
      throw new NotFoundException('Confirmed plan not found.');
    }

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
        summary: workflow.plan.summary,
        implementationPlan: workflow.plan.implementationPlan as string[],
        filesToModify: workflow.plan.filesToModify as string[],
        newFiles: workflow.plan.newFiles as string[],
        riskPoints: workflow.plan.riskPoints as string[],
      },
      workspace: this.buildWorkspaceContext(workflow.requirement.workspace),
    });

    return this.prisma.$transaction(async (tx) => {
      await this.transitionWorkflow(tx, id, WorkflowRunStatus.EXECUTION_PENDING, {
        to: WorkflowRunStatus.EXECUTION_RUNNING,
        stage: StageType.EXECUTION,
      });

      const executionStage = await this.createStageExecution(tx, id, StageType.EXECUTION, {
        input: {
          requirement: workflow.requirement,
          plan: workflow.plan,
        },
        status: StageExecutionStatus.RUNNING,
        startedAt: new Date(),
      });

      await tx.codeExecution.upsert({
        where: { workflowRunId: id },
        create: {
          workflowRunId: id,
          status: 'WAITING_HUMAN_REVIEW',
          patchSummary: output.patchSummary,
          changedFiles: output.changedFiles,
          codeChanges: output.codeChanges,
        },
        update: {
          status: 'WAITING_HUMAN_REVIEW',
          patchSummary: output.patchSummary,
          changedFiles: output.changedFiles,
          codeChanges: output.codeChanges,
        },
      });

      await this.updateStageExecution(tx, executionStage.id, StageExecutionStatus.COMPLETED, {
        output,
        finishedAt: new Date(),
      });

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.EXECUTION_RUNNING, {
        to: WorkflowRunStatus.REVIEW_PENDING,
        stage: StageType.AI_REVIEW,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  async runReview(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.status !== 'REVIEW_PENDING') {
      throw new BadRequestException('Review can only run after execution completes.');
    }
    if (!workflow.plan || !workflow.codeExecution) {
      throw new NotFoundException('Execution context for review is incomplete.');
    }

    const output = await this.aiExecutor.reviewCode({
      requirement: {
        id: workflow.requirement.id,
        title: workflow.requirement.title,
        description: workflow.requirement.description,
        acceptanceCriteria: workflow.requirement.acceptanceCriteria,
      },
      plan: {
        summary: workflow.plan.summary,
        implementationPlan: workflow.plan.implementationPlan as string[],
        filesToModify: workflow.plan.filesToModify as string[],
        newFiles: workflow.plan.newFiles as string[],
        riskPoints: workflow.plan.riskPoints as string[],
      },
      execution: {
        patchSummary: workflow.codeExecution.patchSummary,
        changedFiles: workflow.codeExecution.changedFiles as string[],
        codeChanges: workflow.codeExecution.codeChanges as Array<{
          file: string;
          changeType: 'create' | 'update';
          summary: string;
        }>,
      },
      workspace: this.buildWorkspaceContext(workflow.requirement.workspace),
    });

    return this.prisma.$transaction(async (tx) => {
      const reviewStage = await this.createStageExecution(tx, id, StageType.AI_REVIEW, {
        input: {
          plan: workflow.plan,
          execution: workflow.codeExecution,
        },
        status: StageExecutionStatus.RUNNING,
        startedAt: new Date(),
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
        finishedAt: new Date(),
      });

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.REVIEW_PENDING, {
        to: WorkflowRunStatus.HUMAN_REVIEW_PENDING,
        stage: StageType.HUMAN_REVIEW,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
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
    };
  }

  private buildWorkspaceContext(
    workspace:
      | (Prisma.WorkspaceGetPayload<{
          include: { repositories: true };
        }>)
      | null
      | undefined,
  ) {
    if (!workspace) {
      return null;
    }

    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      repositories: workspace.repositories.map((repository) => ({
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
}

type WorkflowPayload = Prisma.WorkflowRunGetPayload<{
  include: {
    requirement: true;
    stageExecutions: true;
    tasks: true;
    plan: true;
    codeExecution: true;
    reviewReport: true;
  };
}>;
