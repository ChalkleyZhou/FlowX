import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'child_process';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { Prisma } from '@prisma/client';
import { promisify } from 'util';
import {
  FLOWX_PROTOCOL_VERSION,
  type BrainstormCompletionReport,
  type CompletionReport,
  type DesignCompletionReport,
  type OpenDesignBrainstormContextPackage,
  type OpenDesignBrainstormHandoff,
  type OpenDesignContextPackage,
  type OpenDesignHandoff,
  type SourceTool,
} from '@flowx-ai/protocol';
import {
  AI_EXECUTOR_REGISTRY,
  type AIExecutor,
  type AIExecutorProvider,
  type AIExecutorRegistry,
  type AIInvocationContext,
} from '../ai/ai-executor';
import { createNavPlacementAgent } from '../ai/demo-nav-agent-factory';
import { AiInvocationContextService } from '../ai/ai-invocation-context.service';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { assertDesignSpecOutput, assertStrictGenerateDesignOutput } from '../ai/design-output-validate';
import {
  HumanReviewDecision,
  StageExecutionStatus,
  StageType,
  WorkflowRunStatus,
  WorkflowRunType,
} from '../common/enums';
import {
  buildBugFixExecutionFeedback,
  buildBugFixPlanContent,
  buildBugFixRequirementPayload,
  buildBugFixTask,
  type BugFixPayload,
} from './bug-fix-workflow.bootstrap';
import { buildLocalChatRequirementBootstrap } from './local-chat-workflow.bootstrap';
import { StartBugFixWorkflowDto } from '../review-artifacts/dto/start-bug-fix-workflow.dto';
import {
  BrainstormBrief,
  DemoArtifact,
  DemoPage,
  DesignArtifactRef,
  DesignSpec,
  GenerateDesignOutput,
  GeneratePlanOutput,
  RepositoryComponentContext,
  ReviewCodeOutput,
  SplitTasksOutput,
  type ExecuteTaskOutput,
} from '../common/types';
import { dirname, join, sep } from 'path';
import { integrateFlowxDemoRoutes } from '../common/demo-router-integration';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { DingTalkNotificationService } from '../notifications/dingtalk-notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RepositorySyncService } from '../workspaces/repository-sync.service';
import { CompleteLocalExecutionDto } from './dto/complete-local-execution.dto';
import { ACTIVE_EXECUTION_SESSION_STATUSES } from '../execution-sessions/execution-session-state';
import { CreateWorkflowRunDto } from './dto/create-workflow-run.dto';
import { LocalCompletionCommand, type LocalCompletionWorkflowGateway } from './local-completion.command';
import { buildExecutionOutputFromLocalReport } from './workflow-local-execution-output';
import { buildLocalHandoff, type LocalHandoffPayload } from './workflow-local-handoff';
import { WorkflowArtifactService } from './workflow-artifact.service';
import { WorkflowGitRemoteService } from './workflow-git-remote.service';

const execFile = promisify(execFileCallback);

/** 工作流设计阶段 OpenDesign HTML 设计稿落盘根目录。 */
const DESIGN_ARTIFACT_ROOT = join(process.cwd(), '.flowx-data', 'design-artifacts');
/** 单页设计稿落盘上限（防止异常大对象写入磁盘 / 占满预览）。 */
const DESIGN_ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;
/** 注入 Demo 阶段提示的设计稿 HTML 上限（避免提示过长）。 */
const DESIGN_ARTIFACT_DEMO_CONTEXT_MAX_CHARS = 12000;

const workflowStatusMap: Record<WorkflowRunStatus, string> = {
  [WorkflowRunStatus.CREATED]: 'CREATED',
  [WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING]: 'REPOSITORY_GROUNDING_PENDING',
  [WorkflowRunStatus.BRAINSTORM_PENDING]: 'BRAINSTORM_PENDING',
  [WorkflowRunStatus.DESIGN_PENDING]: 'DESIGN_PENDING',
  [WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION]: 'DESIGN_WAITING_CONFIRMATION',
  [WorkflowRunStatus.DEMO_PENDING]: 'DEMO_PENDING',
  [WorkflowRunStatus.DEMO_WAITING_CONFIRMATION]: 'DEMO_WAITING_CONFIRMATION',
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
  [StageExecutionStatus.SKIPPED]: 'SKIPPED',
};

const stageTypeMap: Record<StageType, string> = {
  [StageType.REQUIREMENT_INTAKE]: 'REQUIREMENT_INTAKE',
  [StageType.REPOSITORY_GROUNDING]: 'REPOSITORY_GROUNDING',
  [StageType.BRAINSTORM]: 'BRAINSTORM',
  [StageType.DESIGN]: 'DESIGN',
  [StageType.DEMO]: 'DEMO',
  [StageType.TASK_SPLIT]: 'TASK_SPLIT',
  [StageType.TECHNICAL_PLAN]: 'TECHNICAL_PLAN',
  [StageType.EXECUTION]: 'EXECUTION',
  [StageType.AI_REVIEW]: 'AI_REVIEW',
  [StageType.HUMAN_REVIEW]: 'HUMAN_REVIEW',
};

export type WorkflowNotificationRecipient = {
  flowxUserId: string;
  flowxOrganizationId?: string | null;
  displayName: string;
  providerOrganizationId?: string | null;
  organizationName?: string | null;
};

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);
  private readonly localCompletionCommand: LocalCompletionCommand;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: WorkflowStateMachine,
    private readonly repositorySyncService: RepositorySyncService,
    private readonly dingTalkNotificationService: DingTalkNotificationService,
    private readonly aiInvocationContextService: AiInvocationContextService,
    @Inject(AI_EXECUTOR_REGISTRY) private readonly aiExecutorRegistry: AIExecutorRegistry,
    private readonly workflowArtifactService: WorkflowArtifactService,
    private readonly workflowGitRemoteService: WorkflowGitRemoteService,
    @Optional() private readonly artifactsService?: ArtifactsService,
  ) {
    this.localCompletionCommand = new LocalCompletionCommand(
      workflowArtifactService,
      workflowGitRemoteService,
    );
  }

  async createWorkflowRun(dto: CreateWorkflowRunDto) {
    return this.createRequirementWorkflowRun(dto, WorkflowRunType.FULL);
  }

  async createLocalChatWorkflowRun(dto: CreateWorkflowRunDto) {
    return this.createRequirementWorkflowRun(dto, WorkflowRunType.LOCAL_CHAT);
  }

  async createLocalDesignWorkflowRun(dto: CreateWorkflowRunDto) {
    return this.createRequirementWorkflowRun(dto, WorkflowRunType.LOCAL_DESIGN);
  }

  async createLocalChatBugWorkflowRun(bugId: string, dto: StartBugFixWorkflowDto) {
    const bug = await this.prisma.bug.findUnique({
      where: { id: bugId },
      include: {
        fixWorkflowRun: true,
      },
    });
    if (!bug) {
      throw new NotFoundException('Bug not found.');
    }
    if (!['OPEN', 'CONFIRMED'].includes(bug.status)) {
      throw new BadRequestException('只有开放或已确认状态的缺陷可以发起本地 Chat 修复工作流。');
    }
    if (
      bug.fixWorkflowRun &&
      !['DONE', 'FAILED'].includes(bug.fixWorkflowRun.status)
    ) {
      throw new BadRequestException('该缺陷已有进行中的修复工作流。');
    }

    const requirement = await this.ensureBugFixRequirement(bug);
    const repositoryIds =
      dto.repositoryIds && dto.repositoryIds.length > 0
        ? dto.repositoryIds
        : bug.repositoryId
          ? [bug.repositoryId]
          : undefined;
    const workflow = await this.createRequirementWorkflowRun(
      {
        requirementId: requirement.id,
        repositoryIds,
        aiProvider: dto.aiProvider,
      },
      WorkflowRunType.LOCAL_CHAT,
    );

    await this.prisma.bug.update({
      where: { id: bug.id },
      data: {
        status: 'FIXING',
        fixRequirementId: requirement.id,
        fixWorkflowRunId: workflow.id,
      },
    });

    return workflow;
  }

  private async createRequirementWorkflowRun(dto: CreateWorkflowRunDto, runType: WorkflowRunType) {
    const aiProvider = this.aiInvocationContextService.normalizeAiProvider(dto.aiProvider);
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
          runType,
          aiProvider,
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

    this.startRepositoryGroundingJob(workflow.id);

    return startedWorkflow;
  }

  async createBugFixWorkflowRun(bugId: string, dto: StartBugFixWorkflowDto) {
    const bug = await this.prisma.bug.findUnique({
      where: { id: bugId },
      include: {
        fixWorkflowRun: true,
        workspace: {
          include: {
            repositories: {
              where: { status: 'ACTIVE' },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        project: true,
      },
    });
    if (!bug) {
      throw new NotFoundException('Bug not found.');
    }
    if (!['OPEN', 'CONFIRMED'].includes(bug.status)) {
      throw new BadRequestException('只有开放或已确认状态的缺陷可以发起修复工作流。');
    }
    if (
      bug.fixWorkflowRun &&
      !['DONE', 'FAILED'].includes(bug.fixWorkflowRun.status)
    ) {
      throw new BadRequestException('该缺陷已有进行中的修复工作流。');
    }

    const aiProvider = this.aiInvocationContextService.normalizeAiProvider(dto.aiProvider);
    const requirement = await this.ensureBugFixRequirement(bug);
    const requestedRepositoryIds = Array.from(
      new Set((dto.repositoryIds ?? []).map((value) => value.trim()).filter(Boolean)),
    );
    const workspaceRepositories = bug.workspace.repositories;
    const workspaceRepositoryMap = new Map(
      workspaceRepositories.map((repository) => [repository.id, repository]),
    );
    const defaultRepositories =
      bug.repositoryId && workspaceRepositoryMap.has(bug.repositoryId)
        ? [workspaceRepositoryMap.get(bug.repositoryId)!]
        : workspaceRepositories;
    const selectedRepositories =
      requestedRepositoryIds.length > 0
        ? requestedRepositoryIds.map((repositoryId) => {
            const repository = workspaceRepositoryMap.get(repositoryId);
            if (!repository) {
              throw new NotFoundException(
                'One or more selected repositories do not belong to the bug workspace.',
              );
            }
            return repository;
          })
        : defaultRepositories;

    if (selectedRepositories.length === 0) {
      throw new BadRequestException('当前工作区没有可用仓库，无法发起修复工作流。');
    }

    const selectedRepositoryIds = new Set(selectedRepositories.map((repository) => repository.id));
    const existingActiveWorkflows = await this.prisma.workflowRun.findMany({
      where: {
        requirementId: requirement.id,
        status: { notIn: ['DONE', 'FAILED'] },
      },
      include: { workflowRepositories: true },
    });
    const conflictingWorkflow = existingActiveWorkflows.find((workflowRun) =>
      workflowRun.workflowRepositories.some((repository) =>
        repository.repositoryId ? selectedRepositoryIds.has(repository.repositoryId) : false,
      ),
    );
    if (conflictingWorkflow) {
      throw new BadRequestException(
        `该修复需求已有进行中的工作流 ${conflictingWorkflow.id}，请等待完成或调整仓库范围。`,
      );
    }

    await this.repositorySyncService.syncWorkspaceRepositories(bug.workspaceId);

    const workflow = await this.prisma.$transaction(async (tx) => {
      const workflow = await tx.workflowRun.create({
        data: {
          requirementId: requirement.id,
          status: 'CREATED',
          runType: WorkflowRunType.BUG_FIX,
          aiProvider,
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

      await tx.bug.update({
        where: { id: bug.id },
        data: {
          status: 'FIXING',
          fixRequirementId: requirement.id,
          fixWorkflowRunId: workflow.id,
        },
      });

      return workflow;
    });

    try {
      await this.repositorySyncService.prepareWorkflowRepositories(workflow.id);
    } catch (error) {
      await this.prisma.workflowRun.update({
        where: { id: workflow.id },
        data: { status: 'FAILED' },
      });
      await this.prisma.bug.update({
        where: { id: bug.id },
        data: { status: 'CONFIRMED' },
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
        statusMessage: '正在准备缺陷修复所需仓库上下文',
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id: workflow.id },
        include: this.workflowInclude(),
      });
    });

    this.startRepositoryGroundingJob(workflow.id);

    const refreshedBug = await this.prisma.bug.findUniqueOrThrow({
      where: { id: bug.id },
      include: {
        workspace: true,
        fixWorkflowRun: true,
        fixRequirement: true,
      },
    });

    return {
      bug: refreshedBug,
      requirement,
      workflowRun: startedWorkflow,
      autoStart: dto.autoStart !== false,
    };
  }

  listAiProviders() {
    return {
      defaultProvider: this.aiInvocationContextService.getConfiguredDefaultProvider(),
      providers: this.aiExecutorRegistry.list().map((provider) => ({
        id: provider,
        label: provider === 'cursor' ? 'Cursor CLI' : 'Codex',
      })),
    };
  }

  async findAll(filters?: { runType?: string }) {
    return this.prisma.workflowRun.findMany({
      where: filters?.runType ? { runType: filters.runType } : undefined,
      orderBy: { createdAt: 'desc' },
      include: this.workflowInclude(),
    });
  }

  async findOne(id: string) {
    return this.getWorkflowOrThrow(id);
  }

  async readPlanArtifactHtml(id: string): Promise<string> {
    const html = await this.workflowArtifactService.readPlanHtml(id);
    if (!html) throw new NotFoundException('Plan artifact not found.');
    return html;
  }

  async readExecutionArtifactHtml(id: string): Promise<string> {
    const html = await this.workflowArtifactService.readExecutionHtml(id);
    if (!html) {
      throw new NotFoundException('Execution artifact not found.');
    }
    return html;
  }

  async claimLocalExecution(
    id: string,
    notifyRecipient?: WorkflowNotificationSession,
    sourceTool: SourceTool = 'cursor',
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, StageType.EXECUTION);
    if (workflow.status !== 'EXECUTION_PENDING') {
      throw new BadRequestException('Local execution can only be claimed after plan confirmation.');
    }
    await this.resolveConfirmedPlan(workflow);

    const recipient = this.toNotificationRecipient(notifyRecipient);
    const claimedAt = new Date().toISOString();
    const executionSession = this.isExecutionSessionProjectionEnabled()
      ? {
          id: randomUUID(),
          traceId: randomUUID(),
          protocolVersion: FLOWX_PROTOCOL_VERSION,
        }
      : null;
    const handoffSnapshot = await this.buildLocalHandoffForWorkflow(
      workflow,
      'EXECUTION_RUNNING',
      executionSession,
    );

    const updatedWorkflow = await this.prisma.$transaction(async (tx) => {
      await this.transitionWorkflow(tx, id, WorkflowRunStatus.EXECUTION_PENDING, {
        to: WorkflowRunStatus.EXECUTION_RUNNING,
        stage: StageType.EXECUTION,
      });

      const stageExecution = await this.createStageExecution(tx, id, StageType.EXECUTION, {
        input: {
          executor: 'LOCAL',
          claimedAt,
          claimedByUserId: recipient?.flowxUserId ?? null,
          requirementId: workflow.requirement.id,
          handoffSnapshot,
        },
        status: StageExecutionStatus.RUNNING,
        statusMessage: '等待本地开发完成：请切到工作分支、提交并推送后点击完成',
        startedAt: new Date(),
      });

      if (executionSession) {
        await tx.executionSession.create({
          data: {
            id: executionSession.id,
            workflowRunId: id,
            stageExecutionId: stageExecution.id,
            organizationId: recipient?.flowxOrganizationId ?? null,
            workspaceId:
              workflow.requirement.workspaceId ?? workflow.requirement.project.workspaceId,
            projectId: workflow.requirement.projectId,
            status: 'RUNNING',
            executorType: 'LOCAL',
            sourceTool,
            protocolVersion: executionSession.protocolVersion,
            traceId: executionSession.traceId,
            idempotencyKey: `local-claim:${id}:${stageExecution.id}`,
            claimedByUserId: recipient?.flowxUserId ?? null,
            startedAt: new Date(claimedAt),
            lastHeartbeatAt: new Date(claimedAt),
            metadata: {
              claimSource: 'workflow.claim-local',
              stageAttempt: stageExecution.attempt,
            },
          },
        });
      }

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    const handoff = await this.buildLocalHandoffForWorkflow(
      updatedWorkflow,
      'EXECUTION_RUNNING',
      executionSession,
    );
    return { workflow: updatedWorkflow, handoff };
  }

  async getLocalHandoff(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertLocalExecutionActive(workflow);
    const executionSession = this.isExecutionSessionProjectionEnabled()
      ? await this.findLatestLocalExecutionSession(id)
      : null;
    return this.buildLocalHandoffForWorkflow(workflow, workflow.status, executionSession);
  }

  /**
   * Compatibility entry point for `POST /workflow-runs/:id/execution/complete-local`.
   * Resolves the active LOCAL execution session for this workflow run (when session
   * projection is enabled) and delegates to `completeLocalExecutionBySession`, which is the
   * canonical `LocalCompletionCommand` path. Falls back to running the command directly when
   * no execution session is available so legacy/no-session workflows keep working.
   */
  async completeLocalExecution(
    id: string,
    dto: CompleteLocalExecutionDto,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const executionSession = this.isExecutionSessionProjectionEnabled()
      ? await this.findLatestLocalExecutionSession(id)
      : null;

    if (executionSession) {
      const result = await this.completeLocalExecutionBySession(
        executionSession.id,
        dto,
        notifyRecipient,
      );
      return { workflow: result.workflow, handoff: result.handoff };
    }

    const workflow = await this.getWorkflowOrThrow(id);
    const handoff = await this.buildLocalHandoffForWorkflow(workflow, workflow.status, null);
    const result = await this.localCompletionCommand.run({
      workflow,
      executionSession: null,
      handoff,
      dto,
      notifyRecipient: this.toNotificationRecipient(notifyRecipient),
      gateway: this.buildLocalCompletionGateway(),
    });
    return { workflow: result.workflow, handoff: result.handoff };
  }

  /**
   * Canonical local completion entry point behind `POST /execution-sessions/:id/complete`
   * (spec §6.2). Loads the LOCAL execution session, guards against completing a session that
   * is already terminal with a different report, then runs the single `LocalCompletionCommand`
   * implementation shared with the `complete-local` compatibility wrapper.
   */
  async completeLocalExecutionBySession(
    executionSessionId: string,
    dto: CompleteLocalExecutionDto,
    notifyRecipient?: WorkflowNotificationSession,
    scope: { organizationId?: string | null } = {},
  ) {
    const session = await this.prisma.executionSession.findUnique({
      where: { id: executionSessionId },
    });
    if (!session || session.executorType !== 'LOCAL') {
      throw new NotFoundException('Local execution session not found.');
    }
    if (session.organizationId && session.organizationId !== scope.organizationId?.trim()) {
      throw new ConflictException('Execution session belongs to another organization.');
    }

    const workflow = await this.getWorkflowOrThrow(session.workflowRunId);
    const handoff = await this.buildLocalHandoffForWorkflow(workflow, workflow.status, session);
    const completionReport = this.buildCompletionReport(session.id, handoff, dto);
    const existingKey = this.readCompletionIdempotencyKey(session.metadata);

    if (session.status === 'COMPLETED') {
      if (existingKey === completionReport.idempotencyKey) {
        return { workflow, handoff, executionSession: session };
      }
      throw new ConflictException({
        code: 'EXECUTION_SESSION_TERMINAL',
        message: `Execution session ${executionSessionId} was already completed with another report.`,
      });
    }
    if (!ACTIVE_EXECUTION_SESSION_STATUSES.includes(session.status as never)) {
      throw new ConflictException({
        code: 'EXECUTION_SESSION_TERMINAL',
        message: `Execution session ${executionSessionId} is already ${session.status}.`,
      });
    }

    const result = await this.localCompletionCommand.run({
      workflow,
      executionSession: session,
      handoff,
      dto,
      notifyRecipient: this.toNotificationRecipient(notifyRecipient),
      gateway: this.buildLocalCompletionGateway(),
    });

    const updatedSession = await this.prisma.executionSession.findUniqueOrThrow({
      where: { id: executionSessionId },
    });
    return { workflow: result.workflow, handoff: result.handoff, executionSession: updatedSession };
  }

  private buildLocalCompletionGateway(): LocalCompletionWorkflowGateway {
    return {
      getWorkflowOrThrow: (workflowRunId) => this.getWorkflowOrThrow(workflowRunId),
      buildCompletionReport: (executionSessionId, handoff, dto) =>
        this.buildCompletionReport(executionSessionId, handoff, dto),
      readCompletionIdempotencyKey: (metadata) => this.readCompletionIdempotencyKey(metadata),
      assertLocalExecutionActive: (workflow) => this.assertLocalExecutionActive(workflow),
      sanitizeExecutionOutputPaths: (output, repositories) =>
        this.sanitizeExecutionOutputPaths(output, repositories),
      getLatestStageOrThrow: (workflow, stage) => this.getLatestStageOrThrow(workflow, stage),
      finalizeExecutionSuccess: (workflowRunId, stageOutput, options) =>
        this.finalizeExecutionSuccess(workflowRunId, stageOutput, options),
    };
  }

  async cancelLocalExecution(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertLocalExecutionActive(workflow);
    const executionStage = this.getLatestStageOrThrow(workflow, StageType.EXECUTION);
    const executionSession = this.isExecutionSessionProjectionEnabled()
      ? await this.findLatestLocalExecutionSession(id, true)
      : null;

    return this.prisma.$transaction(async (tx) => {
      await this.updateStageExecution(tx, executionStage.id, StageExecutionStatus.REJECTED, {
        errorMessage: 'User cancelled local execution',
        statusMessage: '本地执行已取消',
        finishedAt: new Date(),
      });
      await this.transitionWorkflow(tx, id, WorkflowRunStatus.EXECUTION_RUNNING, {
        to: WorkflowRunStatus.EXECUTION_PENDING,
        stage: StageType.EXECUTION,
      });
      if (executionSession) {
        await tx.executionSession.updateMany({
          where: {
            id: executionSession.id,
            status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] },
          },
          data: {
            status: 'CANCELLED',
            completedAt: new Date(),
            errorCode: 'LOCAL_EXECUTION_CANCELLED',
            errorMessage: 'User cancelled local execution',
          },
        });
      }
      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  /**
   * Roll back one pipeline stage for debugging: workflow moves to the previous stage's entry state
   * and downstream artifacts are cleared so you can re-run from there.
   */
  async rollbackToPreviousStage(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (workflow.stageExecutions.some((stage) => stage.status === 'RUNNING')) {
      throw new BadRequestException('当前工作流仍有阶段在执行中，请等待完成后再回退。');
    }

    const fromStatus = this.fromPrismaWorkflowStatus(workflow.status);
    const resolved = this.resolveRollbackTarget(workflow, fromStatus);
    if (!resolved) {
      throw new BadRequestException('当前状态无法回退到上一阶段（已在仓库 grounding 阶段或 CREATED）。');
    }

    const { to, stage, skipCreateStageExecution } = resolved;

    const updatedWorkflow = await this.prisma.$transaction(async (tx) => {
      await this.applyRollbackDataCleanup(tx, id, to, fromStatus);

      await this.transitionWorkflow(tx, id, fromStatus, { to, stage });

      if (to === WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING) {
        await this.createStageExecution(tx, id, StageType.REPOSITORY_GROUNDING, {
          input: {
            workflowRunId: id,
            repositories: workflow.workflowRepositories.map((repository) => ({
              id: repository.id,
              name: repository.name,
              url: repository.url,
            })),
            source: 'rollback',
          },
          status: StageExecutionStatus.RUNNING,
          statusMessage: '正在重新生成仓库 grounding 上下文',
          startedAt: new Date(),
        });
      } else if (!skipCreateStageExecution) {
        await this.createStageExecution(tx, id, stage, {
          input: {
            requirementId: workflow.requirementId,
            workflowRunId: id,
            source: 'rollback',
          },
          status: StageExecutionStatus.PENDING,
          statusMessage: '已回退到此阶段，请重新执行',
        });
      }

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    if (to === WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING) {
      this.startRepositoryGroundingJob(id);
    }

    return updatedWorkflow;
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

  async runBrainstorm(
    id: string,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    const aiExecutor = this.resolveAiExecutor(workflow.aiProvider);
    const aiProviderLabel = this.getAiProviderLabel(workflow.aiProvider);
    this.assertStageNotRunning(workflow, StageType.BRAINSTORM);
    const workflowStatus = this.fromPrismaWorkflowStatus(workflow.status);
    if (workflowStatus !== WorkflowRunStatus.BRAINSTORM_PENDING) {
      throw new BadRequestException('Brainstorm can only run after repository grounding.');
    }

    const recipient = this.toNotificationRecipient(notifyRecipient);
    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      const existingStage = await this.getOrCreateRunnableSkippableStageExecution(
        tx,
        id,
        StageType.BRAINSTORM,
      );
      await this.updateStageExecution(tx, existingStage.id, StageExecutionStatus.RUNNING, {
        input: {
          requirement: workflow.requirement,
          notifier: recipient,
        },
        statusMessage: `正在调用 ${aiProviderLabel} 生成产品简报`,
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`brainstorm:${id}`, async () => {
      try {
        const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
          workflow.aiProvider,
          recipient,
        );
        const output = await aiExecutor.brainstorm(
          {
            requirementTitle: workflow.requirement.title,
            requirementDescription: workflow.requirement.description,
            workspaceContext: workflow.requirement.workspace?.name ?? undefined,
          },
          invocationContext,
        );

        await this.prisma.$transaction(async (tx) => {
          const brainstormStage = await tx.stageExecution.findFirstOrThrow({
            where: {
              workflowRunId: id,
              stage: stageTypeMap[StageType.BRAINSTORM],
              status: 'RUNNING',
            },
            orderBy: { attempt: 'desc' },
          });

          await this.updateStageExecution(tx, brainstormStage.id, StageExecutionStatus.COMPLETED, {
            output,
            statusMessage: null,
            finishedAt: new Date(),
          });

          await this.transitionWorkflow(tx, id, WorkflowRunStatus.BRAINSTORM_PENDING, {
            to: WorkflowRunStatus.DESIGN_PENDING,
            stage: StageType.DESIGN,
          });

          await this.createStageExecution(tx, id, StageType.DESIGN, {
            input: {
              workflowRunId: id,
              previousStage: stageTypeMap[StageType.BRAINSTORM],
            },
            status: StageExecutionStatus.PENDING,
            statusMessage: '可生成设计方案，也可以跳过设计继续',
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Brainstorm failed';
        await this.markRunningStageFailed(id, StageType.BRAINSTORM, message);
      }
    });

    return startedWorkflow;
  }

  skipBrainstorm(id: string) {
    return this.skipOptionalStage(id, StageType.BRAINSTORM);
  }

  async runDesign(
    id: string,
    humanFeedback?: string,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    const aiExecutor = this.resolveAiExecutor(workflow.aiProvider);
    const aiProviderLabel = this.getAiProviderLabel(workflow.aiProvider);
    this.assertStageNotRunning(workflow, StageType.DESIGN);
    const workflowStatus = this.fromPrismaWorkflowStatus(workflow.status);
    if (
      workflowStatus !== WorkflowRunStatus.DESIGN_PENDING &&
      !(
        workflowStatus === WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION &&
        humanFeedback !== undefined &&
        humanFeedback.trim().length > 0
      )
    ) {
      throw new BadRequestException(
        'Design can only run while design is pending, or while waiting for confirmation with revision feedback.',
      );
    }

    let revisionPreviousDesign: DesignSpec | null = null;
    if (workflowStatus === WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION && humanFeedback?.trim()) {
      const waitingStage = workflow.stageExecutions
        .filter(
          (s) =>
            s.stage === stageTypeMap[StageType.DESIGN] &&
            s.status === stageStatusMap[StageExecutionStatus.WAITING_CONFIRMATION],
        )
        .sort((a, b) => b.attempt - a.attempt)[0];
      const rawOut =
        waitingStage?.output && typeof waitingStage.output === 'object' && !Array.isArray(waitingStage.output)
          ? (waitingStage.output as Record<string, unknown>)
          : null;
      if (rawOut?.design && typeof rawOut.design === 'object' && !Array.isArray(rawOut.design)) {
        revisionPreviousDesign = rawOut.design as DesignSpec;
      }
    }

    const recipient = this.toNotificationRecipient(notifyRecipient);
    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      if (workflowStatus === WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION && humanFeedback?.trim()) {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION, {
          to: WorkflowRunStatus.DESIGN_PENDING,
          stage: StageType.DESIGN,
        });
      }

      const stageExecution = await this.getOrCreateRunnableSkippableStageExecution(
        tx,
        id,
        StageType.DESIGN,
      );
      await this.updateStageExecution(tx, stageExecution.id, StageExecutionStatus.RUNNING, {
        input: {
          requirement: workflow.requirement,
          humanFeedback: humanFeedback ?? null,
          notifier: recipient,
        },
        statusMessage: `正在调用 ${aiProviderLabel} 生成设计方案`,
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`design:${id}`, async () => {
      try {
        const wf = await this.getWorkflowOrThrow(id);
        const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
          wf.aiProvider,
          recipient,
        );
        const repositoryComponentContext = await this.buildWorkflowRepositoryComponentContext(
          aiExecutor,
          wf,
        );

        const previousDesigns = [
          ...this.getWorkflowPreviousDesigns(wf),
          ...(revisionPreviousDesign ? [revisionPreviousDesign] : []),
        ];

        const designResult = await aiExecutor.generateDesign(
          {
            requirementTitle: wf.requirement.title,
            requirementDescription: wf.requirement.description,
            confirmedBrief: this.getWorkflowBriefContext(wf),
            previousDesigns: previousDesigns.length > 0 ? previousDesigns : undefined,
            humanFeedback: humanFeedback?.trim(),
            repositoryComponentContext: repositoryComponentContext ?? undefined,
          },
          invocationContext,
          { phase: 'design' },
        );

        const artifactRef = designResult.designArtifact?.html
          ? await this.persistWorkflowDesignArtifact(id, designResult.designArtifact.html)
          : undefined;

        const persistedOutput = this.toPersistedDesignStageOutput(designResult, artifactRef);

        await this.prisma.$transaction(async (tx) => {
          const designStage = await tx.stageExecution.findFirstOrThrow({
            where: {
              workflowRunId: id,
              stage: stageTypeMap[StageType.DESIGN],
              status: 'RUNNING',
            },
            orderBy: { attempt: 'desc' },
          });

          await this.updateStageExecution(tx, designStage.id, StageExecutionStatus.WAITING_CONFIRMATION, {
            output: persistedOutput,
            statusMessage: '请确认设计方案（DesignSpec）后再生成 Demo',
            finishedAt: new Date(),
          });

          await this.transitionWorkflow(tx, id, WorkflowRunStatus.DESIGN_PENDING, {
            to: WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
            stage: StageType.DESIGN,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Design failed';
        await this.markRunningStageFailed(id, StageType.DESIGN, message);
      }
    });

    return startedWorkflow;
  }

  /**
   * Accept a design generated locally (e.g. via OpenDesign MCP in the IDE) and move the
   * design stage to WAITING_CONFIRMATION — the local-execution counterpart for the design stage.
   * No server-side AI call is made; the provided output is validated and persisted directly.
   */
  async claimLocalDesign(
    id: string,
    notifyRecipient?: WorkflowNotificationSession,
  ): Promise<{ workflow: WorkflowPayload; handoff: OpenDesignHandoff }> {
    const workflow = await this.getWorkflowOrThrow(id);
    if (this.fromPrismaWorkflowStatus(workflow.status) !== WorkflowRunStatus.DESIGN_PENDING) {
      throw new BadRequestException('Local OpenDesign can only be claimed while design is pending.');
    }
    const existing = await this.findActiveOpenDesignSession(id, 'DESIGN');
    if (existing) {
      return {
        workflow,
        handoff: this.buildOpenDesignHandoff(workflow, existing),
      };
    }

    const recipient = this.toNotificationRecipient(notifyRecipient);
    const sessionRef = {
      id: randomUUID(),
      traceId: randomUUID(),
      protocolVersion: FLOWX_PROTOCOL_VERSION,
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const designStage = await this.getOrCreateRunnableSkippableStageExecution(
        tx,
        id,
        StageType.DESIGN,
      );
      await this.updateStageExecution(tx, designStage.id, StageExecutionStatus.RUNNING, {
        input: {
          source: 'LOCAL_OPENDESIGN',
          claimedByUserId: recipient?.flowxUserId ?? null,
          claimedAt: new Date().toISOString(),
        },
        statusMessage: '本地 OpenDesign 设计中',
        startedAt: new Date(),
      });
      await tx.executionSession.create({
        data: {
          id: sessionRef.id,
          workflowRunId: id,
          stageExecutionId: designStage.id,
          organizationId: recipient?.flowxOrganizationId ?? null,
          workspaceId:
            workflow.requirement.workspaceId ?? workflow.requirement.project.workspaceId,
          projectId: workflow.requirement.projectId,
          status: 'RUNNING',
          executorType: 'LOCAL',
          sourceTool: 'opendesign',
          protocolVersion: sessionRef.protocolVersion,
          traceId: sessionRef.traceId,
          idempotencyKey: `local-design:${id}:${designStage.id}`,
          claimedByUserId: recipient?.flowxUserId ?? null,
          startedAt: new Date(),
          lastHeartbeatAt: new Date(),
          metadata: { stage: 'DESIGN', outputFormat: 'flowx-design-result-v1' },
        },
      });
      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    return {
      workflow: updated,
      handoff: this.buildOpenDesignHandoff(updated, {
        ...sessionRef,
      }),
    };
  }

  async claimLocalBrainstorm(
    id: string,
    notifyRecipient?: WorkflowNotificationSession,
  ): Promise<{ workflow: WorkflowPayload; handoff: OpenDesignBrainstormHandoff }> {
    const workflow = await this.getWorkflowOrThrow(id);
    if (this.fromPrismaWorkflowStatus(workflow.status) !== WorkflowRunStatus.BRAINSTORM_PENDING) {
      throw new BadRequestException(
        'Local OpenDesign brainstorm can only be claimed while brainstorm is pending.',
      );
    }
    const existing = await this.findActiveOpenDesignSession(id, 'BRAINSTORM');
    if (existing) {
      return {
        workflow,
        handoff: this.buildOpenDesignBrainstormHandoff(workflow, existing),
      };
    }

    const recipient = this.toNotificationRecipient(notifyRecipient);
    const sessionRef = {
      id: randomUUID(),
      traceId: randomUUID(),
      protocolVersion: FLOWX_PROTOCOL_VERSION,
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const brainstormStage = await this.getOrCreateRunnableSkippableStageExecution(
        tx,
        id,
        StageType.BRAINSTORM,
      );
      await this.updateStageExecution(tx, brainstormStage.id, StageExecutionStatus.RUNNING, {
        input: {
          source: 'LOCAL_OPENDESIGN',
          claimedByUserId: recipient?.flowxUserId ?? null,
          claimedAt: new Date().toISOString(),
        },
        statusMessage: '本地 OpenDesign 产品构思中',
        startedAt: new Date(),
      });
      await tx.executionSession.create({
        data: {
          id: sessionRef.id,
          workflowRunId: id,
          stageExecutionId: brainstormStage.id,
          organizationId: recipient?.flowxOrganizationId ?? null,
          workspaceId:
            workflow.requirement.workspaceId ?? workflow.requirement.project.workspaceId,
          projectId: workflow.requirement.projectId,
          status: 'RUNNING',
          executorType: 'LOCAL',
          sourceTool: 'opendesign',
          protocolVersion: sessionRef.protocolVersion,
          traceId: sessionRef.traceId,
          idempotencyKey: `local-brainstorm:${id}:${brainstormStage.id}`,
          claimedByUserId: recipient?.flowxUserId ?? null,
          startedAt: new Date(),
          lastHeartbeatAt: new Date(),
          metadata: { stage: 'BRAINSTORM', outputFormat: 'flowx-brainstorm-markdown-v1' },
        },
      });
      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    return {
      workflow: updated,
      handoff: this.buildOpenDesignBrainstormHandoff(updated, {
        ...sessionRef,
      }),
    };
  }

  async getLocalDesignHandoff(id: string): Promise<OpenDesignHandoff> {
    const workflow = await this.getWorkflowOrThrow(id);
    const session = await this.findActiveOpenDesignSession(id, 'DESIGN');
    if (!session) {
      throw new NotFoundException('No active OpenDesign execution session was found.');
    }
    return this.buildOpenDesignHandoff(workflow, session);
  }

  async getLocalBrainstormHandoff(id: string): Promise<OpenDesignBrainstormHandoff> {
    const workflow = await this.getWorkflowOrThrow(id);
    const session = await this.findActiveOpenDesignSession(id, 'BRAINSTORM');
    if (!session) {
      throw new NotFoundException('No active OpenDesign brainstorm session was found.');
    }
    return this.buildOpenDesignBrainstormHandoff(workflow, session);
  }

  async completeLocalDesignSession(
    executionSessionId: string,
    report: DesignCompletionReport,
    scope: { organizationId?: string | null } = {},
  ) {
    const session = await this.prisma.executionSession.findUnique({
      where: { id: executionSessionId },
    });
    if (!session || session.sourceTool !== 'opendesign') {
      throw new NotFoundException('OpenDesign execution session not found.');
    }
    if (!this.isOpenDesignSessionStage(session, 'DESIGN')) {
      throw new BadRequestException('Execution session is not an OpenDesign design session.');
    }
    if (session.organizationId && session.organizationId !== scope.organizationId?.trim()) {
      throw new ConflictException('OpenDesign execution session belongs to another organization.');
    }
    const workflow = await this.getWorkflowOrThrow(session.workflowRunId);
    const existingKey = this.readCompletionIdempotencyKey(session.metadata);
    if (session.status === 'COMPLETED') {
      if (existingKey === report.idempotencyKey) {
        return {
          workflow,
          handoff: this.buildOpenDesignHandoff(workflow, session),
        };
      }
      throw new ConflictException({
        code: 'EXECUTION_SESSION_TERMINAL',
        message: 'OpenDesign execution session was already completed with another report.',
      });
    }
    if (!ACTIVE_EXECUTION_SESSION_STATUSES.includes(session.status as never)) {
      throw new ConflictException({
        code: 'EXECUTION_SESSION_TERMINAL',
        message: `OpenDesign execution session is already ${session.status}.`,
      });
    }
    if (this.fromPrismaWorkflowStatus(workflow.status) !== WorkflowRunStatus.DESIGN_PENDING) {
      throw new BadRequestException('Workflow is no longer waiting for a local design.');
    }

    const parsed = assertDesignSpecOutput(report.output);
    const artifactRef = await this.persistWorkflowDesignArtifact(
      workflow.id,
      parsed.designArtifact.html ?? '',
    );
    const persistedOutput = this.toPersistedDesignStageOutput(
      { design: parsed.design, demo: parsed.demo, demoPages: [] },
      artifactRef,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      if (!session.stageExecutionId) {
        throw new BadRequestException('OpenDesign session is missing its design stage.');
      }
      await this.updateStageExecution(
        tx,
        session.stageExecutionId,
        StageExecutionStatus.WAITING_CONFIRMATION,
        {
          output: persistedOutput,
          statusMessage: '本地 OpenDesign 设计已回传，请确认设计方案',
          finishedAt: new Date(),
        },
      );
      await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.DESIGN_PENDING, {
        to: WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
        stage: StageType.DESIGN,
      });
      const transition = await tx.executionSession.updateMany({
        where: {
          id: executionSessionId,
          status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] },
        },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          summary: report.summary ?? 'OpenDesign design completed.',
          metadata: JSON.parse(
            JSON.stringify({
              ...(session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata)
                ? session.metadata
                : {}),
              completionIdempotencyKey: report.idempotencyKey,
              completionMetadata: report.metadata ?? {},
            }),
          ) as Prisma.InputJsonObject,
        },
      });
      if (transition.count !== 1) {
        throw new ConflictException('OpenDesign execution session changed during completion.');
      }
      const artifact = await tx.artifact.findFirst({
        where: {
          workflowRunId: workflow.id,
          artifactType: 'DESIGN_HTML',
          status: { not: 'DELETED' },
        },
        orderBy: { createdAt: 'desc' },
      });
      await tx.evidence.create({
        data: {
          executionSessionId,
          artifactId: artifact?.id ?? null,
          evidenceType: 'AGENT_SUMMARY',
          sourceTool: 'opendesign',
          title: 'OpenDesign design submission',
          summary: report.summary ?? null,
          status: 'REPORTED',
          occurredAt: new Date(),
          metadata: report.metadata
            ? (JSON.parse(JSON.stringify(report.metadata)) as Prisma.InputJsonObject)
            : undefined,
        },
      });
      return tx.workflowRun.findUniqueOrThrow({
        where: { id: workflow.id },
        include: this.workflowInclude(),
      });
    });

    return {
      workflow: updated,
      handoff: this.buildOpenDesignHandoff(updated, {
        id: session.id,
        traceId: session.traceId,
        protocolVersion: session.protocolVersion,
      }),
    };
  }

  async completeLocalBrainstormSession(
    executionSessionId: string,
    report: BrainstormCompletionReport,
    scope: { organizationId?: string | null } = {},
  ) {
    const session = await this.prisma.executionSession.findUnique({
      where: { id: executionSessionId },
    });
    if (!session || session.sourceTool !== 'opendesign') {
      throw new NotFoundException('OpenDesign brainstorm session not found.');
    }
    if (!this.isOpenDesignSessionStage(session, 'BRAINSTORM')) {
      throw new BadRequestException('Execution session is not an OpenDesign brainstorm session.');
    }
    if (session.organizationId && session.organizationId !== scope.organizationId?.trim()) {
      throw new ConflictException('OpenDesign brainstorm session belongs to another organization.');
    }
    const workflow = await this.getWorkflowOrThrow(session.workflowRunId);
    const existingKey = this.readCompletionIdempotencyKey(session.metadata);
    if (session.status === 'COMPLETED') {
      if (existingKey === report.idempotencyKey) {
        return {
          workflow,
          handoff: this.buildOpenDesignBrainstormHandoff(workflow, session),
        };
      }
      throw new ConflictException({
        code: 'EXECUTION_SESSION_TERMINAL',
        message: 'OpenDesign brainstorm session was already completed with another report.',
      });
    }
    if (!ACTIVE_EXECUTION_SESSION_STATUSES.includes(session.status as never)) {
      throw new ConflictException({
        code: 'EXECUTION_SESSION_TERMINAL',
        message: `OpenDesign brainstorm session is already ${session.status}.`,
      });
    }
    if (this.fromPrismaWorkflowStatus(workflow.status) !== WorkflowRunStatus.BRAINSTORM_PENDING) {
      throw new BadRequestException('Workflow is no longer waiting for a local brainstorm.');
    }

    const markdown = report.markdown?.trim() ?? '';
    if (!markdown) {
      throw new BadRequestException('Brainstorm markdown is required.');
    }
    const persistedOutput = {
      format: 'markdown' as const,
      markdown,
      summary: report.summary?.trim() || undefined,
      source: 'LOCAL_OPENDESIGN',
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (!session.stageExecutionId) {
        throw new BadRequestException('OpenDesign session is missing its brainstorm stage.');
      }
      await this.updateStageExecution(
        tx,
        session.stageExecutionId,
        StageExecutionStatus.COMPLETED,
        {
          output: persistedOutput,
          statusMessage: null,
          finishedAt: new Date(),
        },
      );
      await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.BRAINSTORM_PENDING, {
        to: WorkflowRunStatus.DESIGN_PENDING,
        stage: StageType.DESIGN,
      });
      await this.createStageExecution(tx, workflow.id, StageType.DESIGN, {
        input: {
          workflowRunId: workflow.id,
          previousStage: stageTypeMap[StageType.BRAINSTORM],
        },
        status: StageExecutionStatus.PENDING,
        statusMessage: '可生成设计方案，也可以跳过设计继续',
      });
      const transition = await tx.executionSession.updateMany({
        where: {
          id: executionSessionId,
          status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] },
        },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          summary: report.summary ?? 'OpenDesign brainstorm completed.',
          metadata: JSON.parse(
            JSON.stringify({
              ...(session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata)
                ? session.metadata
                : {}),
              completionIdempotencyKey: report.idempotencyKey,
              completionMetadata: report.metadata ?? {},
            }),
          ) as Prisma.InputJsonObject,
        },
      });
      if (transition.count !== 1) {
        throw new ConflictException('OpenDesign brainstorm session changed during completion.');
      }
      await tx.evidence.create({
        data: {
          executionSessionId,
          evidenceType: 'AGENT_SUMMARY',
          sourceTool: 'opendesign',
          title: 'OpenDesign brainstorm submission',
          summary: report.summary ?? markdown.slice(0, 200),
          status: 'REPORTED',
          occurredAt: new Date(),
          metadata: report.metadata
            ? (JSON.parse(JSON.stringify(report.metadata)) as Prisma.InputJsonObject)
            : undefined,
        },
      });
      return tx.workflowRun.findUniqueOrThrow({
        where: { id: workflow.id },
        include: this.workflowInclude(),
      });
    });

    return {
      workflow: updated,
      handoff: this.buildOpenDesignBrainstormHandoff(updated, {
        id: session.id,
        traceId: session.traceId,
        protocolVersion: session.protocolVersion,
      }),
    };
  }

  async submitLocalDesign(id: string, rawOutput: unknown) {
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, StageType.DESIGN);
    const workflowStatus = this.fromPrismaWorkflowStatus(workflow.status);
    if (
      workflowStatus !== WorkflowRunStatus.DESIGN_PENDING &&
      workflowStatus !== WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION
    ) {
      throw new BadRequestException(
        'Local design can only be submitted while the design stage is pending or waiting for confirmation.',
      );
    }

    const parsed = assertDesignSpecOutput(rawOutput);
    const artifactRef = await this.persistWorkflowDesignArtifact(id, parsed.designArtifact.html ?? '');
    const persistedOutput = this.toPersistedDesignStageOutput(
      { design: parsed.design, demo: parsed.demo, demoPages: [] },
      artifactRef,
    );

    return this.prisma.$transaction(async (tx) => {
      if (workflowStatus === WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION) {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION, {
          to: WorkflowRunStatus.DESIGN_PENDING,
          stage: StageType.DESIGN,
        });
      }

      const stageExecution = await this.getOrCreateRunnableSkippableStageExecution(tx, id, StageType.DESIGN);
      await this.updateStageExecution(tx, stageExecution.id, StageExecutionStatus.RUNNING, {
        input: { source: 'LOCAL_OD_MCP' },
        statusMessage: '本地 OpenDesign 设计已提交，正在记录',
        startedAt: new Date(),
      });
      await this.updateStageExecution(tx, stageExecution.id, StageExecutionStatus.WAITING_CONFIRMATION, {
        output: persistedOutput,
        statusMessage: '请确认本地生成的设计方案（DesignSpec）后再生成 Demo',
        finishedAt: new Date(),
      });
      await this.transitionWorkflow(tx, id, WorkflowRunStatus.DESIGN_PENDING, {
        to: WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
        stage: StageType.DESIGN,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  async confirmDesign(id: string, notifyRecipient?: WorkflowNotificationSession) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (this.fromPrismaWorkflowStatus(workflow.status) !== WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION) {
      throw new BadRequestException('设计方案当前不在待确认状态。');
    }

    const designStage = this.getLatestStageOrThrow(workflow, StageType.DESIGN);
    if (designStage.status !== stageStatusMap[StageExecutionStatus.WAITING_CONFIRMATION]) {
      throw new BadRequestException('设计方案当前不在待确认状态。');
    }

    const updatedWorkflow = await this.prisma.$transaction(async (tx) => {
      await this.updateStageExecution(tx, designStage.id, StageExecutionStatus.COMPLETED, {
        statusMessage: null,
        finishedAt: new Date(),
      });

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION, {
        to: WorkflowRunStatus.DEMO_PENDING,
        stage: StageType.DEMO,
      });

      await this.createStageExecution(tx, id, StageType.DEMO, {
        input: {
          workflowRunId: id,
          previousStage: stageTypeMap[StageType.DESIGN],
        },
        status: StageExecutionStatus.PENDING,
        statusMessage: '可生成 Demo 页面，也可以跳过 Demo 进入任务拆解',
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
      stageName: '设计方案',
      result: '已确认',
      nextStep: '可以生成或跳过 Demo 页面',
    });

    return updatedWorkflow;
  }

  async rejectDesign(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (this.fromPrismaWorkflowStatus(workflow.status) !== WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION) {
      throw new BadRequestException('设计方案当前不在待确认状态。');
    }

    const designStage = this.getLatestStageOrThrow(workflow, StageType.DESIGN);
    if (designStage.status !== stageStatusMap[StageExecutionStatus.WAITING_CONFIRMATION]) {
      throw new BadRequestException('设计方案当前不在待确认状态。');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.updateStageExecution(tx, designStage.id, StageExecutionStatus.REJECTED, {
        finishedAt: new Date(),
      });

      // Close any lingering local OpenDesign sessions so the next “打开本地 OpenDesign”
      // always claims a fresh stage/session instead of reusing a terminal handoff.
      await tx.executionSession.updateMany({
        where: {
          workflowRunId: id,
          sourceTool: 'opendesign',
          status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] },
        },
        data: {
          status: 'CANCELLED',
          completedAt: new Date(),
          summary: 'Cancelled because the design stage was rejected.',
        },
      });

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION, {
        to: WorkflowRunStatus.DESIGN_PENDING,
        stage: StageType.DESIGN,
      });

      await this.createStageExecution(tx, id, StageType.DESIGN, {
        input: {
          workflowRunId: id,
          previousStage: stageTypeMap[StageType.DESIGN],
          source: 'design-rejected',
        },
        status: StageExecutionStatus.PENDING,
        statusMessage: '设计已驳回，可重新用 OpenDesign 或 AI 生成',
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  skipDesign(id: string) {
    return this.skipOptionalStage(id, StageType.DESIGN);
  }

  async runDemo(
    id: string,
    humanFeedback?: string,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    const aiExecutor = this.resolveAiExecutor(workflow.aiProvider);
    const aiProviderLabel = this.getAiProviderLabel(workflow.aiProvider);
    this.assertStageNotRunning(workflow, StageType.DEMO);
    const workflowStatus = this.fromPrismaWorkflowStatus(workflow.status);
    if (!this.canRunDemoFromWorkflow(workflow, workflowStatus)) {
      throw new BadRequestException('Demo can only run after design.');
    }

    const recipient = this.toNotificationRecipient(notifyRecipient);
    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      const stageExecution = await this.getOrCreateRunnableSkippableStageExecution(
        tx,
        id,
        StageType.DEMO,
      );
      if (workflowStatus === WorkflowRunStatus.DEMO_WAITING_CONFIRMATION) {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.DEMO_WAITING_CONFIRMATION, {
          to: WorkflowRunStatus.DEMO_PENDING,
          stage: StageType.DEMO,
        });
      }
      await this.updateStageExecution(tx, stageExecution.id, StageExecutionStatus.RUNNING, {
        input: {
          requirement: workflow.requirement,
          notifier: recipient,
        },
        statusMessage: `正在调用 ${aiProviderLabel} 生成 Demo 页面`,
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`demo:${id}`, async () => {
      try {
        const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
          workflow.aiProvider,
          recipient,
        );
        const repositoryComponentContext = this.ensureWorkflowDemoRepositoryComponentContext(
          id,
          await this.buildWorkflowRepositoryComponentContext(aiExecutor, workflow),
        );

        const designArtifactContext = await this.buildDemoDesignArtifactContext(workflow);

        const result = this.normalizeDesignOutput(
          await aiExecutor.generateDesign(
            {
              requirementTitle: workflow.requirement.title,
              requirementDescription: workflow.requirement.description,
              confirmedBrief: this.getWorkflowBriefContext(workflow),
              previousDesigns: [this.getWorkflowDesignContext(workflow)],
              humanFeedback: [
                humanFeedback?.trim(),
                '请基于当前设计方案生成 demoPages：须含统一前缀根路径上的入口/导航页（单段 route，用 Link 列出子场景）+ 至少一个子路径场景页；不要只生孤立子路由导致必须手输 URL。',
                designArtifactContext,
              ]
                .filter(Boolean)
                .join('\n\n'),
              repositoryComponentContext,
            },
            invocationContext,
          ),
        );

        if (!result.demoPages || result.demoPages.length < 2) {
          throw new Error(
            'DEMO_OUTPUT_INVALID: demoPages must include an entry hub page plus at least one scenario page.',
          );
        }

        await this.writeWorkflowDemoPagesToRepo(result.demoPages, workflow, invocationContext, aiExecutor);

        await this.prisma.$transaction(async (tx) => {
          const demoStage = await tx.stageExecution.findFirstOrThrow({
            where: {
              workflowRunId: id,
              stage: stageTypeMap[StageType.DEMO],
              status: 'RUNNING',
            },
            orderBy: { attempt: 'desc' },
          });

          await this.updateStageExecution(tx, demoStage.id, StageExecutionStatus.WAITING_CONFIRMATION, {
            output: { demo: result.demo, demoPages: result.demoPages },
            statusMessage: '请确认当前 Demo，再进入任务拆解',
          });

          if (workflowStatus === WorkflowRunStatus.DEMO_PENDING) {
            await this.transitionWorkflow(tx, id, WorkflowRunStatus.DEMO_PENDING, {
              to: WorkflowRunStatus.DEMO_WAITING_CONFIRMATION,
              stage: StageType.DEMO,
            });
          } else if (workflowStatus === WorkflowRunStatus.DEMO_WAITING_CONFIRMATION) {
            await this.transitionWorkflow(tx, id, WorkflowRunStatus.DEMO_PENDING, {
              to: WorkflowRunStatus.DEMO_WAITING_CONFIRMATION,
              stage: StageType.DEMO,
            });
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Demo failed';
        await this.markRunningStageFailed(id, StageType.DEMO, message);
      }
    });

    return startedWorkflow;
  }

  skipDemo(id: string) {
    return this.skipOptionalStage(id, StageType.DEMO);
  }

  async confirmDemo(id: string) {
    const workflow = await this.getWorkflowOrThrow(id);
    if (this.fromPrismaWorkflowStatus(workflow.status) !== WorkflowRunStatus.DEMO_WAITING_CONFIRMATION) {
      throw new BadRequestException('Demo can only be confirmed while waiting for confirmation.');
    }

    return this.prisma.$transaction(async (tx) => {
      const demoStage = await tx.stageExecution.findFirstOrThrow({
        where: {
          workflowRunId: id,
          stage: stageTypeMap[StageType.DEMO],
          status: stageStatusMap[StageExecutionStatus.WAITING_CONFIRMATION],
        },
        orderBy: { attempt: 'desc' },
      });

      await this.updateStageExecution(tx, demoStage.id, StageExecutionStatus.COMPLETED, {
        statusMessage: null,
        finishedAt: new Date(),
      });

      await this.transitionWorkflow(tx, id, WorkflowRunStatus.DEMO_WAITING_CONFIRMATION, {
        to: WorkflowRunStatus.TASK_SPLIT_PENDING,
        stage: StageType.TASK_SPLIT,
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  async runTaskSplit(
    id: string,
    humanFeedback?: string,
    notifyRecipient?: WorkflowNotificationSession,
  ) {
    const workflow = await this.getWorkflowOrThrow(id);
    const aiExecutor = this.resolveAiExecutor(workflow.aiProvider);
    const aiProviderLabel = this.getAiProviderLabel(workflow.aiProvider);
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
        statusMessage: `正在调用 ${aiProviderLabel} 进行任务拆解`,
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`task-split:${id}`, async () => {
      try {
        const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
          workflow.aiProvider,
          recipient,
        );
        // Fetch demo page artifacts for context
        const demoContext = this.getWorkflowDemoContext(workflow);

        const splitOutput = await aiExecutor.splitTasks(
          {
            requirement: {
              id: requirement.id,
              title: requirement.title,
              description: requirement.description,
              acceptanceCriteria: requirement.acceptanceCriteria,
            },
            workspace: this.buildWorkspaceContext(workflow.requirement.workspace, workflow.workflowRepositories),
            humanFeedback: humanFeedback ?? null,
            previousOutput: (previousStage?.output as SplitTasksOutput | null) ?? null,
            demoPageContext: demoContext,
          },
          invocationContext,
        );

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
              surface: task.surface,
              repositoryNames: task.repositoryNames,
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
    const aiExecutor = this.resolveAiExecutor(workflow.aiProvider);
    const aiProviderLabel = this.getAiProviderLabel(workflow.aiProvider);
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
      surface: task.surface ?? 'unknown',
      repositoryNames: Array.isArray(task.repositoryNames)
        ? task.repositoryNames.map(String)
        : [],
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
        statusMessage: `正在调用 ${aiProviderLabel} 生成技术方案`,
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`plan:${id}`, async () => {
      try {
        const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
          workflow.aiProvider,
          recipient,
        );
        // Fetch demo page artifacts for context
        const demoArtifacts = await this.prisma.ideationArtifact.findMany({
          where: { requirementId: workflow.requirement.id, type: 'DEMO_PAGE' },
          orderBy: { version: 'desc' },
          take: 1,
        });
        const demoContext = demoArtifacts[0]?.content ?? null;

        const rawOutput = this.normalizePlanOutput((await aiExecutor.generatePlan(
          {
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
            demoPageContext: demoContext,
          },
          invocationContext,
        )) as unknown as Record<string, unknown>);
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

          const stageOutput = await this.attachPlanArtifactToOutput(
            id,
            planStage.attempt,
            output,
          );

          await this.updateStageExecution(tx, planStage.id, StageExecutionStatus.WAITING_CONFIRMATION, {
            output: stageOutput,
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

    await this.workflowArtifactService.confirmPlanArtifact(id);

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

  private async resolveConfirmedPlan(workflow: WorkflowPayload): Promise<GeneratePlanOutput> {
    const meta = await this.workflowArtifactService.loadPlanMeta(workflow.id);
    if (meta?.status === 'CONFIRMED') {
      return {
        summary: meta.summary,
        implementationPlan: meta.implementationPlan,
        filesToModify: meta.filesToModify,
        newFiles: meta.newFiles,
        riskPoints: meta.riskPoints,
      };
    }
    if (!workflow.plan) {
      throw new NotFoundException('Confirmed plan not found.');
    }
    return {
      summary: workflow.plan.summary,
      implementationPlan: workflow.plan.implementationPlan as string[],
      filesToModify: workflow.plan.filesToModify as string[],
      newFiles: workflow.plan.newFiles as string[],
      riskPoints: workflow.plan.riskPoints as string[],
    };
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
    const aiExecutor = this.resolveAiExecutor(workflow.aiProvider);
    const aiProviderLabel = this.getAiProviderLabel(workflow.aiProvider);
    this.assertStageNotRunning(workflow, StageType.EXECUTION);
    const recipient = this.toNotificationRecipient(notifyRecipient);
    if (
      workflow.status !== 'EXECUTION_PENDING' &&
      !(
        (workflow.status === 'REVIEW_PENDING' ||
          workflow.status === 'HUMAN_REVIEW_PENDING' ||
          workflow.status === 'DONE') &&
        humanFeedback
      )
    ) {
      throw new BadRequestException('Execution can only run after plan confirmation.');
    }
    const confirmedPlan = await this.resolveConfirmedPlan(workflow);

    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      if (
        workflow.status === 'REVIEW_PENDING' ||
        workflow.status === 'HUMAN_REVIEW_PENDING' ||
        workflow.status === 'DONE'
      ) {
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
          plan: confirmedPlan,
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
            : trigger?.triggerType === 'bug_fix'
              ? '正在根据缺陷描述修复代码'
              : `正在调用 ${aiProviderLabel} 执行开发`,
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`execution:${id}`, async () => {
      try {
        const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
          workflow.aiProvider,
          recipient,
        );
        const rawOutput = await aiExecutor.executeTask(
          {
            requirement: {
              id: workflow.requirement.id,
              title: workflow.requirement.title,
              description: workflow.requirement.description,
              acceptanceCriteria: workflow.requirement.acceptanceCriteria,
            },
            tasks: workflow.tasks.map((task) => ({
              title: task.title,
              description: task.description,
              surface: task.surface ?? 'unknown',
              repositoryNames: Array.isArray(task.repositoryNames)
                ? task.repositoryNames.map(String)
                : [],
            })),
            plan: confirmedPlan,
            workspace: this.buildWorkspaceContext(workflow.requirement.workspace, workflow.workflowRepositories),
            humanFeedback: humanFeedback ?? null,
          },
          invocationContext,
        );
        const output = this.sanitizeExecutionOutputPaths(rawOutput, workflow.workflowRepositories);

        await this.finalizeExecutionSuccess(id, output, {
          triggerType: trigger?.triggerType,
          notifyRecipient: recipient,
          executor: 'CLOUD',
          requirementTitle: workflow.requirement.title,
          notificationStages: startedWorkflow.stageExecutions,
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
    const aiExecutor = this.resolveAiExecutor(workflow.aiProvider);
    const aiProviderLabel = this.getAiProviderLabel(workflow.aiProvider);
    this.assertStageNotRunning(workflow, StageType.AI_REVIEW);
    const recipient = this.toNotificationRecipient(notifyRecipient);
    if (!this.canRunReviewFromStatus(workflow.status)) {
      throw new BadRequestException('Review can only run after execution completes.');
    }
    if (!workflow.plan || !workflow.codeExecution) {
      throw new NotFoundException('Execution context for review is incomplete.');
    }
    const confirmedPlan = workflow.plan;
    const executionResult = workflow.codeExecution;

    const previousStage =
      workflow.status === 'HUMAN_REVIEW_PENDING' || workflow.status === 'DONE'
        ? this.getLatestStageOrThrow(workflow, StageType.AI_REVIEW)
        : null;
    const startedWorkflow = await this.prisma.$transaction(async (tx) => {
      if (workflow.status === 'HUMAN_REVIEW_PENDING') {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.HUMAN_REVIEW_PENDING, {
          to: WorkflowRunStatus.REVIEW_PENDING,
          stage: StageType.AI_REVIEW,
        });
      } else if (workflow.status === 'DONE') {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.DONE, {
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
        statusMessage: `正在调用 ${aiProviderLabel} 执行 AI 审查`,
        startedAt: new Date(),
      });

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });

    this.runInBackground(`review:${id}`, async () => {
      try {
        const invocationContext = await this.aiInvocationContextService.resolveInvocationContext(
          workflow.aiProvider,
          recipient,
        );
        const output = await aiExecutor.reviewCode(
          {
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
          },
          invocationContext,
        );

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
    if (workflow.status !== 'HUMAN_REVIEW_PENDING' && workflow.status !== 'DONE') {
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

    if (finding.status === this.getReviewFindingStatusAfterFix()) {
      throw new BadRequestException('该条审查结果已触发修复，等待重新审查后再继续处理。');
    }

    await this.prisma.reviewFinding.update({
      where: { id: finding.id },
      data: { status: this.getReviewFindingStatusAfterFix() },
    });

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
      verified: boolean;
      remoteUrl: string;
    }> = [];

    for (const repository of repositories) {
      const cwd = repository.localPath;
      await this.runGit(['checkout', repository.workingBranch], cwd);

      const hasChanges = await this.hasGitChanges(cwd);
      const hasRetryableWorkflowCommit =
        !hasChanges && (await this.headCommitMatchesMessage(cwd, commitMessage));
      if (!hasChanges && !hasRetryableWorkflowCommit) {
        continue;
      }

      if (hasChanges) {
        await this.runGit(['add', '-A'], cwd);
        await this.runGit(['commit', '-m', commitMessage], cwd);
      }
      const publishBranch = this.buildPublishBranchName(
        workflow.requirement.title,
        workflow.id,
        repository.repository,
      );
      await this.runGit(['checkout', '-B', publishBranch], cwd);
      const remoteUrl = await this.resolvePublishRemoteUrl(repository);
      await this.runGit(
        ['push', '--set-upstream', remoteUrl, `${publishBranch}:refs/heads/${publishBranch}`],
        cwd,
      );
      const verified = await this.remoteBranchExists(cwd, remoteUrl, publishBranch);
      if (!verified) {
        throw new BadRequestException(
          `代码库 ${repository.repository} 推送后未在远端校验到分支 ${publishBranch}。远端：${remoteUrl}`,
        );
      }
      await this.runGit(['checkout', repository.workingBranch], cwd);

      publishedRepositories.push({
        repository: repository.repository,
        branch: publishBranch,
        commitSha: await this.getHeadSha(cwd),
        pushed: true,
        verified: true,
        remoteUrl,
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
        remoteUrl: repository.url,
      }));

    if (workflowRepositories.length > 0) {
      return workflowRepositories;
    }

    const legacyArtifacts = Array.isArray(workflow.codeExecution?.diffArtifacts)
      ? (workflow.codeExecution.diffArtifacts as Array<Record<string, unknown>>)
      : [];

    const deduplicated = new Map<
      string,
      { repository: string; workingBranch: string; localPath: string; remoteUrl?: string }
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

      await this.syncBugFixWorkflowOutcome(
        tx,
        id,
        workflow.runType,
        nextStatus === WorkflowRunStatus.DONE
          ? 'completed'
          : nextStatus === WorkflowRunStatus.FAILED
            ? 'failed'
            : 'rework',
      );

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
          surface: String((task as { surface?: unknown }).surface ?? 'unknown'),
          repositoryNames: Array.isArray((task as { repositoryNames?: unknown }).repositoryNames)
            ? ((task as { repositoryNames: unknown[] }).repositoryNames ?? []).map(String)
            : [],
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
      fixForBug: true,
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

  private async buildLocalHandoffForWorkflow(
    workflow: WorkflowPayload,
    status: string,
    executionSession?: {
      id: string;
      traceId: string;
      protocolVersion: string;
    } | null,
  ): Promise<LocalHandoffPayload> {
    const plan = await this.resolveConfirmedPlan(workflow);
    const manifest = await this.workflowArtifactService.readManifest(workflow.id);
    const { planMetaPath, planHtmlPath } = this.workflowArtifactService.getPlanArtifactPaths(manifest);

    return buildLocalHandoff({
      workflowRunId: workflow.id,
      status,
      executionSession,
      requirement: {
        id: workflow.requirement.id,
        title: workflow.requirement.title,
        description: workflow.requirement.description,
        acceptanceCriteria: workflow.requirement.acceptanceCriteria,
      },
      plan,
      tasks: workflow.tasks,
      workflowRepositories: workflow.workflowRepositories,
      planMetaPath,
      planHtmlPath,
    });
  }

  private buildOpenDesignHandoff(
    workflow: WorkflowPayload,
    session: {
      id: string;
      traceId: string;
      protocolVersion: string;
    },
  ): OpenDesignHandoff {
    const contextPackage: OpenDesignContextPackage = {
      protocolVersion: session.protocolVersion,
      generatedAt: new Date().toISOString(),
      sourceTool: 'opendesign',
      workflowRunId: workflow.id,
      executionSessionId: session.id,
      traceId: session.traceId,
      requirement: {
        id: workflow.requirement.id,
        title: workflow.requirement.title,
        description: workflow.requirement.description,
        acceptanceCriteria: workflow.requirement.acceptanceCriteria,
      },
      repositories: workflow.workflowRepositories.map((repository) => ({
        repositoryId: repository.repositoryId ?? repository.id,
        workflowRepositoryId: repository.id,
        name: repository.name,
        url: repository.url || null,
        baseBranch: repository.baseBranch,
        workingBranch: repository.workingBranch,
      })),
      outputContract: {
        resultFileName: 'result.json',
        format: 'flowx-design-result-v1',
        requiredFields: ['design', 'demo', 'designArtifact'],
      },
      metadata: {
        workflowStatus: workflow.status,
        runType: workflow.runType,
        stage: 'DESIGN',
      },
    };
    return {
      protocolVersion: session.protocolVersion,
      workflowRunId: workflow.id,
      executionSessionId: session.id,
      traceId: session.traceId,
      contextPackage,
      completionEndpoint: `/execution-sessions/${session.id}/design/complete`,
    };
  }

  private buildOpenDesignBrainstormHandoff(
    workflow: WorkflowPayload,
    session: {
      id: string;
      traceId: string;
      protocolVersion: string;
    },
  ): OpenDesignBrainstormHandoff {
    const contextPackage: OpenDesignBrainstormContextPackage = {
      protocolVersion: session.protocolVersion,
      generatedAt: new Date().toISOString(),
      sourceTool: 'opendesign',
      stage: 'BRAINSTORM',
      workflowRunId: workflow.id,
      executionSessionId: session.id,
      traceId: session.traceId,
      requirement: {
        id: workflow.requirement.id,
        title: workflow.requirement.title,
        description: workflow.requirement.description,
        acceptanceCriteria: workflow.requirement.acceptanceCriteria,
      },
      repositories: workflow.workflowRepositories.map((repository) => ({
        repositoryId: repository.repositoryId ?? repository.id,
        workflowRepositoryId: repository.id,
        name: repository.name,
        url: repository.url || null,
        baseBranch: repository.baseBranch,
        workingBranch: repository.workingBranch,
      })),
      outputContract: {
        resultFileName: 'spec.md',
        format: 'flowx-brainstorm-markdown-v1',
      },
      metadata: {
        workflowStatus: workflow.status,
        runType: workflow.runType,
      },
    };
    return {
      protocolVersion: session.protocolVersion,
      workflowRunId: workflow.id,
      executionSessionId: session.id,
      traceId: session.traceId,
      contextPackage,
      completionEndpoint: `/execution-sessions/${session.id}/brainstorm/complete`,
    };
  }

  private async findActiveOpenDesignSession(
    workflowRunId: string,
    stage: 'BRAINSTORM' | 'DESIGN',
  ) {
    const sessions = await this.prisma.executionSession.findMany({
      where: {
        workflowRunId,
        sourceTool: 'opendesign',
        status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.find((session) => this.isOpenDesignSessionStage(session, stage)) ?? null;
  }

  private isOpenDesignSessionStage(
    session: { metadata: unknown },
    stage: 'BRAINSTORM' | 'DESIGN',
  ) {
    const metadata = session.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return stage === 'DESIGN';
    }
    const recorded = (metadata as { stage?: unknown }).stage;
    if (typeof recorded !== 'string' || !recorded.trim()) {
      return stage === 'DESIGN';
    }
    return recorded.trim().toUpperCase() === stage;
  }

  private isExecutionSessionProjectionEnabled() {
    return process.env.FLOWX_EXECUTION_SESSION_WRITE_ENABLED?.trim().toLowerCase() !== 'false';
  }

  private findLatestLocalExecutionSession(workflowRunId: string, activeOnly = false) {
    return this.prisma.executionSession.findFirst({
      where: {
        workflowRunId,
        executorType: 'LOCAL',
        ...(activeOnly ? { status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private buildCompletionReport(
    executionSessionId: string,
    handoff: LocalHandoffPayload,
    dto: CompleteLocalExecutionDto,
  ): CompletionReport {
    const repositories = dto.repositories.map((report) => ({
      workflowRepositoryId: report.workflowRepositoryId,
      headSha: report.headSha,
      changedFiles: report.changedFiles,
      patchSummary: report.patchSummary,
    }));
    const stablePayload = JSON.stringify({
      pushed: dto.pushed,
      implementationSummary: dto.implementationSummary ?? null,
      testResult: dto.testResult ?? null,
      diffSummary: dto.diffSummary ?? null,
      untrackedFiles: dto.untrackedFiles ?? [],
      repositories,
    });
    return {
      idempotencyKey:
        dto.idempotencyKey?.trim() ||
        `completion:${executionSessionId}:${createHash('sha256').update(stablePayload).digest('hex')}`,
      pushed: dto.pushed,
      implementationSummary: dto.implementationSummary,
      testResult: dto.testResult,
      diffSummary: dto.diffSummary,
      untrackedFiles: dto.untrackedFiles,
      repositories,
    };
  }

  private readCompletionIdempotencyKey(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }
    const value = (metadata as Record<string, unknown>).completionIdempotencyKey;
    return typeof value === 'string' ? value : null;
  }

  private assertLocalExecutionActive(workflow: WorkflowPayload) {
    if (workflow.status !== 'EXECUTION_RUNNING') {
      throw new BadRequestException('Workflow is not running local execution.');
    }
    const executionStage = workflow.stageExecutions
      .filter((stage) => stage.stage === stageTypeMap[StageType.EXECUTION])
      .sort((left, right) => right.attempt - left.attempt)[0];
    const input = executionStage?.input;
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      (input as Record<string, unknown>).executor !== 'LOCAL'
    ) {
      throw new BadRequestException('Workflow is not claimed for local execution.');
    }
  }

  private async finalizeExecutionSuccess(
    id: string,
    output: ExecuteTaskOutput,
    options: {
      triggerType?: string;
      notifyRecipient?: WorkflowNotificationRecipient | null;
      executor: 'LOCAL' | 'CLOUD';
      requirementTitle: string;
      notificationStages?: WorkflowPayload['stageExecutions'];
      localCompletion?: {
        executionSession: LocalExecutionSessionProjection;
        completionReport: CompletionReport;
        verificationRows: Array<{ workflowRepositoryId: string; verified: boolean }>;
        repositories: LocalHandoffPayload['repositories'];
      };
    },
  ): Promise<void> {
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

      const nextWorkflowStatus = this.getExecutionCompletionTargetStatus(options.triggerType);

      if (nextWorkflowStatus === WorkflowRunStatus.HUMAN_REVIEW_PENDING) {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.EXECUTION_RUNNING, {
          to: WorkflowRunStatus.REVIEW_PENDING,
          stage: StageType.AI_REVIEW,
        });
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.REVIEW_PENDING, {
          to: WorkflowRunStatus.HUMAN_REVIEW_PENDING,
          stage: StageType.HUMAN_REVIEW,
        });
      } else {
        await this.transitionWorkflow(tx, id, WorkflowRunStatus.EXECUTION_RUNNING, {
          to: nextWorkflowStatus,
          stage: StageType.AI_REVIEW,
        });
      }

      if (options.localCompletion) {
        await this.completeExecutionSessionProjection(tx, id, options.localCompletion);
      }
    });

    const stages = options.notificationStages;
    this.notifyStageCompleted({
      recipient:
        (stages ? this.readNotificationRecipient(stages, StageType.EXECUTION) : null) ??
        options.notifyRecipient,
      workflowRunId: id,
      requirementTitle: options.requirementTitle,
      stageName: '执行开发',
      result: options.executor === 'LOCAL' ? '本地执行已完成' : '已完成',
      nextStep:
        options.triggerType === 'review_finding_fix'
          ? '可继续修复其他审查结果，或按需重新执行 AI 审查'
          : options.triggerType === 'bug_fix'
            ? '等待 AI 审查与人工确认'
            : '可以开始 AI 审查阶段',
    });
  }

  private async completeExecutionSessionProjection(
    tx: Prisma.TransactionClient,
    workflowRunId: string,
    input: {
      executionSession: LocalExecutionSessionProjection;
      completionReport: CompletionReport;
      verificationRows: Array<{ workflowRepositoryId: string; verified: boolean }>;
      repositories: LocalHandoffPayload['repositories'];
    },
  ) {
    const completedAt = new Date();
    const existingMetadata =
      input.executionSession.metadata &&
      typeof input.executionSession.metadata === 'object' &&
      !Array.isArray(input.executionSession.metadata)
        ? (input.executionSession.metadata as Record<string, unknown>)
        : {};
    const transition = await tx.executionSession.updateMany({
      where: {
        id: input.executionSession.id,
        status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] },
      },
      data: {
        status: 'COMPLETED',
        completedAt,
        summary:
          input.completionReport.implementationSummary ??
          input.completionReport.diffSummary ??
          'Local execution completed.',
        metadata: JSON.parse(
          JSON.stringify({
            ...existingMetadata,
            completionIdempotencyKey: input.completionReport.idempotencyKey,
            completionReport: input.completionReport,
          }),
        ) as Prisma.InputJsonObject,
      },
    });
    if (transition.count !== 1) {
      throw new ConflictException({
        code: 'EXECUTION_SESSION_CONFLICT',
        message: `Execution session ${input.executionSession.id} was already finalized.`,
      });
    }

    const executionArtifact = await tx.artifact.findFirst({
      where: {
        workflowRunId,
        artifactType: 'EXECUTION_REPORT',
        status: { not: 'DELETED' },
      },
      orderBy: { createdAt: 'desc' },
    });
    const repositories = new Map(
      input.repositories.map((repository) => [repository.workflowRepositoryId, repository]),
    );
    const verification = new Map(
      input.verificationRows.map((row) => [row.workflowRepositoryId, row.verified]),
    );
    const createEvidence = (data: {
      artifactId?: string | null;
      evidenceType: string;
      title: string;
      summary?: string | null;
      metadata?: Record<string, unknown>;
    }) =>
      tx.evidence.create({
        data: {
          executionSessionId: input.executionSession.id,
          artifactId: data.artifactId ?? null,
          evidenceType: data.evidenceType,
          sourceTool: input.executionSession.sourceTool,
          title: data.title,
          summary: data.summary ?? null,
          status: 'REPORTED',
          occurredAt: completedAt,
          metadata: data.metadata
            ? (JSON.parse(JSON.stringify(data.metadata)) as Prisma.InputJsonObject)
            : undefined,
        },
      });

    for (const report of input.completionReport.repositories) {
      const repository = repositories.get(report.workflowRepositoryId);
      await createEvidence({
        evidenceType: 'GIT_COMMIT',
        title: `${repository?.name ?? report.workflowRepositoryId} commit ${report.headSha.slice(0, 12)}`,
        summary: report.patchSummary ?? null,
        metadata: {
          workflowRepositoryId: report.workflowRepositoryId,
          repositoryId: repository?.repositoryId ?? null,
          workingBranch: repository?.workingBranch ?? null,
          headSha: report.headSha,
          pushed: input.completionReport.pushed,
        },
      });
      await createEvidence({
        evidenceType: 'CHANGED_FILES',
        title: `${repository?.name ?? report.workflowRepositoryId} changed files`,
        summary: `${report.changedFiles.length} files changed`,
        metadata: {
          workflowRepositoryId: report.workflowRepositoryId,
          changedFiles: report.changedFiles,
        },
      });
      if (verification.has(report.workflowRepositoryId)) {
        const verified = verification.get(report.workflowRepositoryId) ?? false;
        await createEvidence({
          evidenceType: 'REMOTE_BRANCH_VERIFICATION',
          title: `${repository?.name ?? report.workflowRepositoryId} remote branch verification`,
          summary: verified ? 'Remote branch tip verified.' : 'Repository has no remote verification.',
          metadata: {
            workflowRepositoryId: report.workflowRepositoryId,
            workingBranch: repository?.workingBranch ?? null,
            headSha: report.headSha,
            verified,
          },
        });
      }
    }

    if (input.completionReport.testResult) {
      await createEvidence({
        artifactId: executionArtifact?.id ?? null,
        evidenceType: 'TEST_RESULT',
        title: 'Local execution test result',
        summary: input.completionReport.testResult,
      });
    }
    if (
      input.completionReport.implementationSummary ||
      input.completionReport.diffSummary
    ) {
      await createEvidence({
        artifactId: executionArtifact?.id ?? null,
        evidenceType: 'AGENT_SUMMARY',
        title: 'Local execution summary',
        summary:
          input.completionReport.implementationSummary ??
          input.completionReport.diffSummary ??
          null,
        metadata: {
          diffSummary: input.completionReport.diffSummary ?? null,
          untrackedFiles: input.completionReport.untrackedFiles ?? [],
        },
      });
    }
  }

  private async attachPlanArtifactToOutput(
    workflowRunId: string,
    version: number,
    output: GeneratePlanOutput,
  ): Promise<GeneratePlanOutput & {
    _artifact?: {
      kind: 'plan';
      version: number;
      htmlPath: string;
      metaPath: string;
      sha256: string;
    };
  }> {
    try {
      const { htmlPath, metaPath, sha256 } = await this.workflowArtifactService.writePlanArtifact({
        workflowRunId,
        version,
        output,
        status: 'WAITING_HUMAN_CONFIRMATION',
      });
      return {
        ...output,
        _artifact: {
          kind: 'plan',
          version,
          htmlPath,
          metaPath,
          sha256,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to write plan artifact for workflow ${workflowRunId}: ${message}`,
      );
      return { ...output };
    }
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

  private normalizePlanOutput(output: Record<string, unknown>): GeneratePlanOutput {
    const summaryCandidates = [
      output.summary,
      output.overview,
      output.objective,
      output.planTitle,
      output.requirementTitle,
    ];
    const summary =
      summaryCandidates.find((value) => typeof value === 'string' && value.trim().length > 0)?.toString().trim() ??
      '已生成技术方案，请查看 implementationPlan。';

    const implementationPlan = this.collectPlanImplementationSteps(output);
    const filesToModify = this.collectStringArray(
      output.filesToModify,
      output.aggregateFilesToModify,
      ...this.collectStageFieldValues(output, 'filesToModify'),
    );
    const newFiles = this.collectStringArray(
      output.newFiles,
      output.aggregateNewFiles,
      ...this.collectStageFieldValues(output, 'newFiles'),
    );
    const riskPoints = this.collectPlanRiskPoints(output);

    return {
      summary,
      implementationPlan,
      filesToModify,
      newFiles,
      riskPoints,
    };
  }

  private collectPlanImplementationSteps(output: Record<string, unknown>): string[] {
    const direct = this.collectStringArray(output.implementationPlan);
    if (direct.length > 0) {
      return direct;
    }

    const stages = Array.isArray(output.stages) ? output.stages : [];
    const stageSteps = stages.flatMap((stage) => {
      if (!stage || typeof stage !== 'object') {
        return [];
      }

      const stageRecord = stage as Record<string, unknown>;
      const stageName =
        typeof stageRecord.name === 'string' && stageRecord.name.trim().length > 0
          ? stageRecord.name.trim()
          : typeof stageRecord.stage === 'string' && stageRecord.stage.trim().length > 0
            ? stageRecord.stage.trim()
            : '阶段';
      const items = this.collectStringArray(
        stageRecord.goals,
        stageRecord.steps,
        stageRecord.implementationSteps,
        stageRecord.verification,
        stageRecord.notes,
      );

      return items.map((item) => `${stageName}: ${item}`);
    });

    if (stageSteps.length > 0) {
      return stageSteps;
    }

    return this.collectStringArray(output.confirmedTaskMapping, output.assumptionsAndUncertainties);
  }

  private collectPlanRiskPoints(output: Record<string, unknown>): string[] {
    const direct = this.collectStringArray(output.riskPoints, output.risks);
    if (direct.length > 0) {
      return direct;
    }

    const riskEntries = Array.isArray(output.riskPointsDetailed)
      ? output.riskPointsDetailed
      : Array.isArray(output.riskPoints)
        ? output.riskPoints
        : [];

    const objectRisks = riskEntries.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const record = item as Record<string, unknown>;
      const parts = [record.description, record.mitigation]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim());
      return parts.length > 0 ? [parts.join(' ')] : [];
    });

    return objectRisks;
  }

  private collectStageFieldValues(output: Record<string, unknown>, fieldName: string): unknown[] {
    const stages = Array.isArray(output.stages) ? output.stages : [];
    return stages.map((stage) =>
      stage && typeof stage === 'object' ? (stage as Record<string, unknown>)[fieldName] : undefined,
    );
  }

  private collectStringArray(...values: unknown[]): string[] {
    const flattened: string[] = values.flatMap((value): string[] => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? [trimmed] : [];
      }

      if (Array.isArray(value)) {
        return value.flatMap((item: unknown) => this.collectStringArray(item));
      }

      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return [
          typeof record.summary === 'string' ? record.summary.trim() : null,
          typeof record.technicalMapping === 'string' ? record.technicalMapping.trim() : null,
          typeof record.technicalApproach === 'string' ? record.technicalApproach.trim() : null,
        ].filter((item): item is string => Boolean(item && item.length > 0));
      }

      return [];
    });

    return Array.from(new Set(flattened));
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
      return allowParentDirectory
        ? this.expandAncestorCandidates(dirname(targetPath), matchedRepository.localPath)
        : [targetPath];
    }

    return availableRepositories
      .map((repository) => {
        const targetPath = join(repository.localPath!, normalized);
        return allowParentDirectory
          ? this.expandAncestorCandidates(dirname(targetPath), repository.localPath!)
          : [targetPath];
      })
      .flat();
  }

  private expandAncestorCandidates(targetDirectory: string, repositoryRoot: string) {
    const candidates = [targetDirectory];
    let cursor = targetDirectory;

    while (cursor.startsWith(repositoryRoot) && cursor !== repositoryRoot) {
      cursor = dirname(cursor);
      candidates.push(cursor);
    }

    return Array.from(new Set(candidates));
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

  private async skipOptionalStage(id: string, stage: StageType) {
    const next = this.resolveOptionalStageSkipTarget(stage);
    const workflow = await this.getWorkflowOrThrow(id);
    this.assertStageNotRunning(workflow, stage);

    const workflowStatus = this.fromPrismaWorkflowStatus(workflow.status);
    const allowedFrom = next.fromStatuses ?? [next.from];
    if (!allowedFrom.includes(workflowStatus)) {
      throw new BadRequestException(
        `Cannot skip ${stageTypeMap[stage]} from status ${workflow.status}. Expected one of: ${allowedFrom
          .map((s) => workflowStatusMap[s])
          .join(', ')}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const stageExecution = await this.getOrCreateSkippableStageExecution(tx, id, stage);

      await this.updateStageExecution(tx, stageExecution.id, StageExecutionStatus.SKIPPED, {
        output: this.buildSkippedStageOutput(next.reason),
        statusMessage: '已跳过，后续将使用已有上下文继续',
        finishedAt: new Date(),
      });

      await this.transitionWorkflow(tx, id, workflowStatus, {
        to: next.to,
        stage: next.nextStage ?? undefined,
      });

      if (next.pendingStage) {
        await this.createStageExecution(tx, id, next.pendingStage, {
          input: {
            workflowRunId: id,
            previousStage: stageTypeMap[stage],
          },
          status: StageExecutionStatus.PENDING,
          statusMessage: next.pendingStatusMessage,
        });
      }

      return tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: this.workflowInclude(),
      });
    });
  }

  private async getOrCreateSkippableStageExecution(
    tx: Prisma.TransactionClient,
    workflowRunId: string,
    stage: StageType,
  ) {
    const latest = await tx.stageExecution.findFirst({
      where: {
        workflowRunId,
        stage: stageTypeMap[stage],
      },
      orderBy: { attempt: 'desc' },
    });

    if (!latest) {
      return this.createStageExecution(tx, workflowRunId, stage, {
        status: StageExecutionStatus.PENDING,
        statusMessage: '等待处理',
      });
    }

    if (latest.status === 'PENDING' || latest.status === 'FAILED') {
      return latest;
    }

    if (latest.status === 'WAITING_CONFIRMATION') {
      return latest;
    }

    throw new BadRequestException(
      `Cannot skip ${stageTypeMap[stage]} from stage status ${latest.status}.`,
    );
  }

  private async getOrCreateRunnableSkippableStageExecution(
    tx: Prisma.TransactionClient,
    workflowRunId: string,
    stage: StageType,
  ) {
    const latest = await tx.stageExecution.findFirst({
      where: {
        workflowRunId,
        stage: stageTypeMap[stage],
      },
      orderBy: { attempt: 'desc' },
    });

    if (!latest) {
      return this.createStageExecution(tx, workflowRunId, stage, {
        status: StageExecutionStatus.PENDING,
        statusMessage: '等待处理',
      });
    }

    if (latest.status === 'PENDING') {
      return latest;
    }

    if (
      latest.status === 'FAILED' ||
      latest.status === 'WAITING_CONFIRMATION' ||
      latest.status === 'REJECTED'
    ) {
      return this.createStageExecution(tx, workflowRunId, stage, {
        status: StageExecutionStatus.PENDING,
        statusMessage: '等待重试',
      });
    }

    throw new BadRequestException(
      `Cannot run ${stageTypeMap[stage]} from stage status ${latest.status}.`,
    );
  }

  private resolveOptionalStageSkipTarget(stage: StageType): {
    from: WorkflowRunStatus;
    fromStatuses?: WorkflowRunStatus[];
    to: WorkflowRunStatus;
    nextStage: StageType | null;
    pendingStage: StageType | null;
    pendingStatusMessage: string | null;
    reason: string;
  } {
    switch (stage) {
      case StageType.BRAINSTORM:
        return {
          from: WorkflowRunStatus.BRAINSTORM_PENDING,
          to: WorkflowRunStatus.DESIGN_PENDING,
          nextStage: StageType.DESIGN,
          pendingStage: StageType.DESIGN,
          pendingStatusMessage: '可生成设计方案，也可以跳过设计继续',
          reason: 'User chose to skip brainstorm and continue with the original requirement.',
        };
      case StageType.DESIGN:
        return {
          from: WorkflowRunStatus.DESIGN_PENDING,
          fromStatuses: [
            WorkflowRunStatus.DESIGN_PENDING,
            WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
          ],
          to: WorkflowRunStatus.DEMO_PENDING,
          nextStage: StageType.DEMO,
          pendingStage: StageType.DEMO,
          pendingStatusMessage: '可生成 Demo 页面，也可以跳过 Demo 进入任务拆解',
          reason: 'User chose to skip design and continue without design context.',
        };
      case StageType.DEMO:
        return {
          from: WorkflowRunStatus.DEMO_PENDING,
          fromStatuses: [
            WorkflowRunStatus.DEMO_PENDING,
            WorkflowRunStatus.DEMO_WAITING_CONFIRMATION,
          ],
          to: WorkflowRunStatus.TASK_SPLIT_PENDING,
          nextStage: StageType.TASK_SPLIT,
          pendingStage: null,
          pendingStatusMessage: null,
          reason: 'User chose to skip demo generation and continue without demo pages.',
        };
      default:
        throw new BadRequestException(`${stageTypeMap[stage]} cannot be skipped.`);
    }
  }

  private buildSkippedStageOutput(reason: string) {
    return {
      skipped: true,
      source: 'user',
      reason,
    };
  }

  private normalizeDesignOutput(output: unknown): GenerateDesignOutput {
    return assertStrictGenerateDesignOutput(output);
  }

  /**
   * Persist only the design spec, demo intent, and the persisted design-artifact reference
   * (without the inline HTML — that is stored on disk) for the design-confirmation gate.
   * Runnable demo pages are generated in the Demo stage after the spec is confirmed.
   */
  private toPersistedDesignStageOutput(
    output: GenerateDesignOutput,
    artifactRef?: DesignArtifactRef,
  ): Pick<GenerateDesignOutput, 'design' | 'demo'> & { designArtifact?: DesignArtifactRef } {
    return {
      design: output.design,
      demo: output.demo,
      ...(artifactRef ? { designArtifact: artifactRef } : {}),
    };
  }

  /** 把设计阶段生成的单页 HTML 落盘到 `.flowx-data/design-artifacts/<runId>/`，返回不含 html 的引用。 */
  private async persistWorkflowDesignArtifact(
    workflowRunId: string,
    html: string,
  ): Promise<DesignArtifactRef> {
    const bytes = Buffer.byteLength(html, 'utf8');
    if (bytes > DESIGN_ARTIFACT_MAX_BYTES) {
      throw new Error(
        `DESIGN_ARTIFACT_TOO_LARGE: design artifact HTML is ${bytes} bytes, exceeds limit ${DESIGN_ARTIFACT_MAX_BYTES}.`,
      );
    }
    const generatedAt = new Date().toISOString();
    const fileName = `design-${generatedAt.replace(/[:.]/g, '-')}.html`;
    const relPath = `${workflowRunId}/${fileName}`;
    const absDir = join(DESIGN_ARTIFACT_ROOT, workflowRunId);
    await mkdir(absDir, { recursive: true });
    await writeFile(join(absDir, fileName), html, 'utf8');
    if (this.artifactsService) {
      try {
        await this.artifactsService.registerWorkflowArtifact({
          workflowRunId,
          artifactType: 'DESIGN_HTML',
          name: `设计稿 ${generatedAt}`,
          version: generatedAt,
          storageProvider: 'local',
          storageKey: `design/${relPath}`,
          mimeType: 'text/html; charset=utf-8',
          byteSize: bytes,
          sha256: createHash('sha256').update(html).digest('hex'),
          status: 'AVAILABLE',
          metadata: { generatedAt },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Design artifact file was written but metadata registration failed for workflow ${workflowRunId}: ${message}`,
        );
      }
    }
    return { relPath, bytes, generatedAt };
  }

  /** Resolve and read a persisted design-artifact HTML by its stored relative path (guards against traversal). */
  private async readWorkflowDesignArtifactHtml(relPath: string): Promise<string | null> {
    const normalized = relPath.replace(/\\/g, '/');
    if (normalized.includes('..') || normalized.startsWith('/')) {
      return null;
    }
    const abs = join(DESIGN_ARTIFACT_ROOT, normalized);
    if (!abs.startsWith(DESIGN_ARTIFACT_ROOT + sep)) {
      return null;
    }
    try {
      return await readFile(abs, 'utf8');
    } catch {
      return null;
    }
  }

  /** Latest design-stage designArtifact ref (WAITING_CONFIRMATION 优先，其次最近 COMPLETED)。 */
  private getLatestDesignArtifactRef(workflow: WorkflowPayload): DesignArtifactRef | null {
    const designStages = workflow.stageExecutions
      .filter((item) => item.stage === stageTypeMap[StageType.DESIGN])
      .sort((a, b) => b.attempt - a.attempt);
    for (const stage of designStages) {
      const output =
        stage.output && typeof stage.output === 'object' && !Array.isArray(stage.output)
          ? (stage.output as Record<string, unknown>)
          : null;
      const ref = output?.designArtifact;
      if (ref && typeof ref === 'object' && !Array.isArray(ref) && typeof (ref as DesignArtifactRef).relPath === 'string') {
        return ref as DesignArtifactRef;
      }
    }
    return null;
  }

  /** Demo 阶段把已确认的设计稿 HTML 作为额外上下文喂给 agent（截断以控制提示长度）。 */
  private async buildDemoDesignArtifactContext(workflow: WorkflowPayload): Promise<string | null> {
    const ref = this.getLatestDesignArtifactRef(workflow);
    if (!ref?.relPath) {
      return null;
    }
    const html = await this.readWorkflowDesignArtifactHtml(ref.relPath);
    if (!html) {
      return null;
    }
    const truncated =
      html.length > DESIGN_ARTIFACT_DEMO_CONTEXT_MAX_CHARS
        ? `${html.slice(0, DESIGN_ARTIFACT_DEMO_CONTEXT_MAX_CHARS)}\n<!-- ...(已截断) -->`
        : html;
    return `已确认的高保真设计稿（OpenDesign 单页 HTML，作为视觉与布局参照；请让 demoPages 的结构、信息层级与视觉风格对齐它，但仍用目标仓库的真实组件实现）:\n${truncated}`;
  }

  /** 读取工作流最新设计稿 HTML，供只读预览端点使用。 */
  async getWorkflowDesignArtifact(
    id: string,
  ): Promise<{ exists: boolean; html: string | null; generatedAt?: string }> {
    const workflow = await this.getWorkflowOrThrow(id);
    const ref = this.getLatestDesignArtifactRef(workflow);
    if (!ref?.relPath) {
      return { exists: false, html: null };
    }
    const html = await this.readWorkflowDesignArtifactHtml(ref.relPath);
    return { exists: Boolean(html), html, generatedAt: ref.generatedAt };
  }

  private getWorkflowDemoContext(workflow: WorkflowPayload): DemoArtifact | null {
    const stage = this.getLatestCompletedStageOutput(workflow, StageType.DEMO);
    if (stage?.demo && typeof stage.demo === 'object' && !Array.isArray(stage.demo)) {
      return stage.demo as DemoArtifact;
    }

    const waitingStage = workflow.stageExecutions
      .filter((item) => item.stage === stageTypeMap[StageType.DEMO] && item.status === 'WAITING_CONFIRMATION')
      .sort((a, b) => b.attempt - a.attempt)[0];

    if (
      waitingStage?.output &&
      typeof waitingStage.output === 'object' &&
      !Array.isArray(waitingStage.output) &&
      'demo' in (waitingStage.output as Record<string, unknown>)
    ) {
      const candidate = (waitingStage.output as Record<string, unknown>).demo;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate as DemoArtifact;
      }
    }

    return null;
  }

  private getWorkflowBriefContext(workflow: WorkflowPayload): BrainstormBrief {
    const stage = this.getLatestCompletedStageOutput(workflow, StageType.BRAINSTORM);
    if (stage?.brief && typeof stage.brief === 'object' && !Array.isArray(stage.brief)) {
      return stage.brief as BrainstormBrief;
    }

    return {
      expandedDescription: workflow.requirement.description?.trim() || workflow.requirement.title,
      userStories: [],
      edgeCases: [],
      successMetrics: [],
      openQuestions: [],
      assumptions: [],
      outOfScope: [],
    };
  }

  private getWorkflowPreviousDesigns(workflow: WorkflowPayload): DesignSpec[] {
    return workflow.stageExecutions
      .filter((item) => item.stage === stageTypeMap[StageType.DESIGN] && item.status === 'COMPLETED')
      .map((item) => {
        const output =
          item.output && typeof item.output === 'object' && !Array.isArray(item.output)
            ? (item.output as Record<string, unknown>)
            : null;
        return output?.design && typeof output.design === 'object' && !Array.isArray(output.design)
          ? (output.design as DesignSpec)
          : null;
      })
      .filter((item): item is DesignSpec => Boolean(item));
  }

  private getWorkflowDesignContext(workflow: WorkflowPayload): DesignSpec {
    const previousDesigns = this.getWorkflowPreviousDesigns(workflow);
    if (previousDesigns.length > 0) {
      return previousDesigns[previousDesigns.length - 1];
    }

    return {
      overview: workflow.requirement.description?.trim() || workflow.requirement.title,
      pages: [],
      demoScenario: workflow.requirement.title,
      designRationale: 'Generated directly from requirement context without a confirmed design stage.',
    };
  }

  private getLatestCompletedStageOutput(workflow: WorkflowPayload, stage: StageType): Record<string, unknown> | null {
    const latestStage = workflow.stageExecutions
      .filter((item) => item.stage === stageTypeMap[stage] && item.status === 'COMPLETED')
      .sort((a, b) => b.attempt - a.attempt)[0];

    if (!latestStage?.output || typeof latestStage.output !== 'object' || Array.isArray(latestStage.output)) {
      return null;
    }

    return latestStage.output as Record<string, unknown>;
  }

  private canRunDemoFromWorkflow(workflow: WorkflowPayload, workflowStatus: WorkflowRunStatus) {
    if (workflowStatus === WorkflowRunStatus.DEMO_PENDING) {
      return true;
    }

    return workflowStatus === WorkflowRunStatus.DEMO_WAITING_CONFIRMATION;
  }

  /**
   * Demo 必须基于工作流仓库克隆中的真实组件/页面证据生成，禁止在无扫描上下文时调用模型。
   */
  private ensureWorkflowDemoRepositoryComponentContext(
    workflowId: string,
    context: RepositoryComponentContext | null,
  ): RepositoryComponentContext {
    if (!context) {
      throw new Error(
        `DEMO_REPOSITORY_CONTEXT_MISSING: workflow=${workflowId} 需要先有可用的工作流仓库副本（READY），且执行器能从克隆路径扫描到组件或页面样例（.tsx）。请确认仓库接地已完成；Mock 执行器也会走磁盘扫描，若克隆目录为空请检查接地结果。`,
      );
    }
    const hasEvidence =
      (context.componentFiles?.length ?? 0) > 0 || (context.pageExamples?.length ?? 0) > 0;
    if (!hasEvidence) {
      throw new Error(
        `DEMO_REPOSITORY_CONTEXT_EMPTY: workflow=${workflowId} 已连接仓库路径，但在常见目录下未发现可用的 .tsx。请确认仓库为前端工程且包含 src/components、src/pages（或 apps/*/src/...）等路径后再试。`,
      );
    }
    return context;
  }

  private async buildWorkflowRepositoryComponentContext(
    executor: AIExecutor,
    workflow: WorkflowPayload,
  ) {
    const repositories = workflow.workflowRepositories.filter(
      (repository) => repository.localPath && repository.status === 'READY',
    );

    if (repositories.length === 0) {
      this.logger.warn(
        `Workflow component context skipped workflow=${workflow.id}: no READY workflow repositories.`,
      );
      return null;
    }

    const repo = repositories[0];
    const repoContext = {
      id: repo.repositoryId ?? repo.id,
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.baseBranch,
      localPath: repo.localPath!,
      syncStatus: repo.status,
    };

    if (
      'buildRepositoryComponentContext' in executor &&
      typeof (executor as { buildRepositoryComponentContext?: unknown }).buildRepositoryComponentContext ===
        'function'
    ) {
      const built = await (executor as any).buildRepositoryComponentContext(repoContext);
      if (built) {
        const files = Array.isArray(built.componentFiles) ? built.componentFiles.length : 0;
        const pages = Array.isArray(built.pageExamples) ? built.pageExamples.length : 0;
        this.logger.log(
          `Workflow component context built workflow=${workflow.id} repo=${repoContext.id} componentFiles=${files} pageExamples=${pages}`,
        );
      } else {
        this.logger.warn(
          `Workflow component context empty workflow=${workflow.id} repo=${repoContext.id} localPath=${repoContext.localPath}`,
        );
      }
      return built;
    }

    this.logger.warn(
      `Workflow component context unavailable workflow=${workflow.id}: executor ${executor.constructor?.name ?? 'unknown'} has no buildRepositoryComponentContext.`,
    );
    return null;
  }

  private async writeWorkflowDemoPagesToRepo(
    demoPages: DemoPage[],
    workflow: WorkflowPayload,
    invocationContext: AIInvocationContext | undefined,
    aiExecutor: AIExecutor,
  ): Promise<void> {
    const repositories = workflow.workflowRepositories.filter(
      (repository) => repository.localPath && repository.status === 'READY',
    );

    if (repositories.length === 0) {
      throw new Error('DEMO_REPOSITORY_NOT_READY: No READY workflow repositories are available for demo generation.');
    }

    for (const page of demoPages) {
      const fullPath = join(repositories[0].localPath!, page.filePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, page.componentCode, 'utf8');
    }

    const routeIntegration = await integrateFlowxDemoRoutes(repositories[0].localPath!, demoPages, {
      navPlacementAgent: createNavPlacementAgent(aiExecutor, invocationContext),
    });
    for (const w of routeIntegration.warnings) {
      this.logger.warn(w);
    }
    if (routeIntegration.routerRelativePath && routeIntegration.normalizedRoutes.length > 0) {
      this.logger.log(
        `FlowX demo preview routes (relative to SPA basename): ${routeIntegration.normalizedRoutes.join(', ')} — router patch: ${routeIntegration.generatedRelativePath ?? 'n/a'}`,
      );
    }
    if (routeIntegration.navMenuPatch?.patchedRelativePath) {
      this.logger.log(`FlowX demo nav patched: ${routeIntegration.navMenuPatch.patchedRelativePath}`);
    }
  }

  private startRepositoryGroundingJob(workflowId: string) {
    this.runInBackground(`grounding:${workflowId}`, async () => {
      try {
        await this.repositorySyncService.generateWorkflowRepositoryGrounding(workflowId);
        const groundedWorkflow = await this.getWorkflowOrThrow(workflowId);
        const groundingOutput = this.buildGroundingStageOutput(groundedWorkflow.workflowRepositories);

        await this.prisma.$transaction(async (tx) => {
          const groundingStage = await tx.stageExecution.findFirstOrThrow({
            where: {
              workflowRunId: workflowId,
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

          const localDesign = groundedWorkflow.runType === WorkflowRunType.LOCAL_DESIGN;
          await this.transitionWorkflow(
            tx,
            workflowId,
            WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
            {
              to: localDesign
                ? WorkflowRunStatus.DESIGN_PENDING
                : WorkflowRunStatus.BRAINSTORM_PENDING,
              stage: localDesign ? StageType.DESIGN : StageType.BRAINSTORM,
            },
          );

          if (localDesign) {
            await this.createStageExecution(tx, workflowId, StageType.DESIGN, {
              input: {
                requirementId: groundedWorkflow.requirementId,
                source: 'opendesign-edge',
              },
              status: StageExecutionStatus.PENDING,
              statusMessage: '等待本地 OpenDesign 领取设计任务',
            });
          } else if (groundedWorkflow.runType === WorkflowRunType.BUG_FIX) {
            const bug = await tx.bug.findFirst({
              where: { fixWorkflowRunId: workflowId },
            });
            if (!bug) {
              throw new NotFoundException('Bug fix workflow is missing its linked bug.');
            }
            await this.applyBugFixBootstrap(
              tx,
              workflowId,
              bug,
              groundedWorkflow.workflowRepositories.map((repository) => repository.name),
            );
          } else if (groundedWorkflow.runType === WorkflowRunType.LOCAL_CHAT) {
            await this.applyLocalChatBootstrap(
              tx,
              groundedWorkflow,
              groundedWorkflow.workflowRepositories.map((repository) => repository.name),
            );
          } else {
            await this.createStageExecution(tx, workflowId, StageType.BRAINSTORM, {
              input: {
                requirementId: groundedWorkflow.requirementId,
                source: 'workflow',
              },
              status: StageExecutionStatus.PENDING,
              statusMessage: '可生成产品简报，也可以跳过构思继续',
            });
          }
        });

        if (groundedWorkflow.runType === WorkflowRunType.BUG_FIX) {
          const bug = await this.prisma.bug.findFirst({
            where: { fixWorkflowRunId: workflowId },
          });
          if (bug) {
            await this.runExecution(
              workflowId,
              buildBugFixExecutionFeedback({
                title: bug.title,
                description: bug.description,
                expectedBehavior: bug.expectedBehavior,
                actualBehavior: bug.actualBehavior,
                reproductionSteps: Array.isArray(bug.reproductionSteps)
                  ? bug.reproductionSteps.map(String)
                  : [],
              }),
              {
                triggerType: 'bug_fix',
                findingTitle: bug.title,
              },
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Repository grounding failed';
        const failedWorkflow = await this.prisma.workflowRun.findUnique({
          where: { id: workflowId },
          select: { runType: true },
        });
        await this.prisma.$transaction(async (tx) => {
          const groundingStage = await tx.stageExecution.findFirst({
            where: {
              workflowRunId: workflowId,
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
            where: { id: workflowId },
            data: {
              status: workflowStatusMap[WorkflowRunStatus.FAILED],
              currentStage: stageTypeMap[StageType.REPOSITORY_GROUNDING],
            },
          });

          if (failedWorkflow?.runType === WorkflowRunType.BUG_FIX) {
            await tx.bug.updateMany({
              where: { fixWorkflowRunId: workflowId, status: 'FIXING' },
              data: { status: 'CONFIRMED' },
            });
          }
        });
      }
    });
  }

  private resolveRollbackTarget(
    workflow: WorkflowPayload,
    fromStatus: WorkflowRunStatus,
  ): { to: WorkflowRunStatus; stage: StageType; skipCreateStageExecution: boolean } | null {
    if (fromStatus === WorkflowRunStatus.CREATED) {
      return null;
    }

    if (fromStatus === WorkflowRunStatus.FAILED) {
      return this.resolveRollbackTargetFromFailed(workflow);
    }

    if (fromStatus === WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING) {
      return null;
    }

    if (fromStatus === WorkflowRunStatus.DONE) {
      return {
        to: WorkflowRunStatus.HUMAN_REVIEW_PENDING,
        stage: StageType.HUMAN_REVIEW,
        skipCreateStageExecution: true,
      };
    }

    const table: Array<
      [WorkflowRunStatus, { to: WorkflowRunStatus; stage: StageType }]
    > = [
      [WorkflowRunStatus.BRAINSTORM_PENDING, { to: WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING, stage: StageType.REPOSITORY_GROUNDING }],
      [WorkflowRunStatus.DESIGN_PENDING, { to: WorkflowRunStatus.BRAINSTORM_PENDING, stage: StageType.BRAINSTORM }],
      [WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION, { to: WorkflowRunStatus.BRAINSTORM_PENDING, stage: StageType.BRAINSTORM }],
      [WorkflowRunStatus.DEMO_PENDING, { to: WorkflowRunStatus.DESIGN_PENDING, stage: StageType.DESIGN }],
      [WorkflowRunStatus.DEMO_WAITING_CONFIRMATION, { to: WorkflowRunStatus.DESIGN_PENDING, stage: StageType.DESIGN }],
      [WorkflowRunStatus.TASK_SPLIT_PENDING, { to: WorkflowRunStatus.DEMO_PENDING, stage: StageType.DEMO }],
      [WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION, { to: WorkflowRunStatus.DEMO_PENDING, stage: StageType.DEMO }],
      [WorkflowRunStatus.TASK_SPLIT_CONFIRMED, { to: WorkflowRunStatus.DEMO_PENDING, stage: StageType.DEMO }],
      [WorkflowRunStatus.PLAN_PENDING, { to: WorkflowRunStatus.TASK_SPLIT_PENDING, stage: StageType.TASK_SPLIT }],
      [WorkflowRunStatus.PLAN_WAITING_CONFIRMATION, { to: WorkflowRunStatus.TASK_SPLIT_PENDING, stage: StageType.TASK_SPLIT }],
      [WorkflowRunStatus.PLAN_CONFIRMED, { to: WorkflowRunStatus.TASK_SPLIT_PENDING, stage: StageType.TASK_SPLIT }],
      [WorkflowRunStatus.EXECUTION_PENDING, { to: WorkflowRunStatus.PLAN_PENDING, stage: StageType.TECHNICAL_PLAN }],
      [WorkflowRunStatus.EXECUTION_RUNNING, { to: WorkflowRunStatus.PLAN_PENDING, stage: StageType.TECHNICAL_PLAN }],
      [WorkflowRunStatus.REVIEW_PENDING, { to: WorkflowRunStatus.EXECUTION_PENDING, stage: StageType.EXECUTION }],
      [WorkflowRunStatus.HUMAN_REVIEW_PENDING, { to: WorkflowRunStatus.REVIEW_PENDING, stage: StageType.AI_REVIEW }],
    ];

    for (const [status, target] of table) {
      if (fromStatus === status) {
        return { ...target, skipCreateStageExecution: false };
      }
    }

    return null;
  }

  private resolveRollbackTargetFromFailed(
    workflow: WorkflowPayload,
  ): { to: WorkflowRunStatus; stage: StageType; skipCreateStageExecution: boolean } {
    const raw = workflow.currentStage?.trim();
    if (!raw) {
      throw new BadRequestException('失败状态缺少 currentStage，无法回退。');
    }
    const entry = Object.entries(stageTypeMap).find(([, value]) => value === raw);
    if (!entry) {
      throw new BadRequestException(`无法识别 currentStage：${raw}`);
    }
    const failedAt = entry[0] as StageType;
    if (failedAt === StageType.REQUIREMENT_INTAKE) {
      throw new BadRequestException('该阶段暂不支持从失败状态回退。');
    }
    if (failedAt === StageType.REPOSITORY_GROUNDING) {
      throw new BadRequestException('仓库 grounding 失败时无法回退，请检查仓库后重新创建工作流。');
    }
    return { ...this.rollbackEntryAfterFailedStage(failedAt), skipCreateStageExecution: false };
  }

  private rollbackEntryAfterFailedStage(
    failedAt: StageType,
  ): { to: WorkflowRunStatus; stage: StageType } {
    switch (failedAt) {
      case StageType.BRAINSTORM:
        return { to: WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING, stage: StageType.REPOSITORY_GROUNDING };
      case StageType.DESIGN:
        return { to: WorkflowRunStatus.BRAINSTORM_PENDING, stage: StageType.BRAINSTORM };
      case StageType.DEMO:
        return { to: WorkflowRunStatus.DESIGN_PENDING, stage: StageType.DESIGN };
      case StageType.TASK_SPLIT:
        return { to: WorkflowRunStatus.DEMO_PENDING, stage: StageType.DEMO };
      case StageType.TECHNICAL_PLAN:
        return { to: WorkflowRunStatus.TASK_SPLIT_PENDING, stage: StageType.TASK_SPLIT };
      case StageType.EXECUTION:
        return { to: WorkflowRunStatus.PLAN_PENDING, stage: StageType.TECHNICAL_PLAN };
      case StageType.AI_REVIEW:
        return { to: WorkflowRunStatus.EXECUTION_PENDING, stage: StageType.EXECUTION };
      case StageType.HUMAN_REVIEW:
        return { to: WorkflowRunStatus.REVIEW_PENDING, stage: StageType.AI_REVIEW };
      default:
        throw new BadRequestException('该失败阶段暂不支持回退。');
    }
  }

  private async applyRollbackDataCleanup(
    tx: Prisma.TransactionClient,
    workflowId: string,
    target: WorkflowRunStatus,
    fromStatus: WorkflowRunStatus,
  ) {
    if (
      fromStatus === WorkflowRunStatus.DONE &&
      target === WorkflowRunStatus.HUMAN_REVIEW_PENDING
    ) {
      return;
    }

    await tx.reviewFinding.deleteMany({ where: { workflowRunId: workflowId } });
    await tx.reviewReport.deleteMany({ where: { workflowRunId: workflowId } });

    if (
      target === WorkflowRunStatus.REVIEW_PENDING ||
      target === WorkflowRunStatus.EXECUTION_PENDING
    ) {
      return;
    }

    await tx.codeExecution.deleteMany({ where: { workflowRunId: workflowId } });

    if (target === WorkflowRunStatus.PLAN_PENDING) {
      await tx.plan.deleteMany({ where: { workflowRunId: workflowId } });
      return;
    }

    await tx.plan.deleteMany({ where: { workflowRunId: workflowId } });
    await tx.task.deleteMany({ where: { workflowRunId: workflowId } });
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

  private getExecutionCompletionTargetStatus(triggerType?: string): WorkflowRunStatus {
    return triggerType === 'review_finding_fix' || triggerType === 'bug_fix'
      ? WorkflowRunStatus.HUMAN_REVIEW_PENDING
      : WorkflowRunStatus.REVIEW_PENDING;
  }

  private async syncBugFixWorkflowOutcome(
    tx: Prisma.TransactionClient,
    workflowRunId: string,
    runType: string | null | undefined,
    outcome: 'completed' | 'failed' | 'rework',
  ) {
    if (runType !== WorkflowRunType.BUG_FIX) {
      return;
    }

    const statusByOutcome: Record<typeof outcome, string> = {
      completed: 'FIXED',
      failed: 'CONFIRMED',
      rework: 'FIXING',
    };

    await tx.bug.updateMany({
      where: { fixWorkflowRunId: workflowRunId },
      data: { status: statusByOutcome[outcome] },
    });
  }

  private async ensureBugFixRequirement(bug: {
    id: string;
    title: string;
    description: string;
    expectedBehavior: string | null;
    actualBehavior: string | null;
    reproductionSteps: Prisma.JsonValue;
    workspaceId: string;
    projectId: string | null;
    fixRequirementId: string | null;
  }) {
    if (bug.fixRequirementId) {
      return this.prisma.requirement.findUniqueOrThrow({
        where: { id: bug.fixRequirementId },
      });
    }

    const projectId = bug.projectId ?? (await this.ensureDefaultBugFixProject(bug.workspaceId));
    const reproductionSteps = Array.isArray(bug.reproductionSteps)
      ? bug.reproductionSteps.map(String)
      : [];
    const payload = buildBugFixRequirementPayload({
      title: bug.title,
      description: bug.description,
      expectedBehavior: bug.expectedBehavior,
      actualBehavior: bug.actualBehavior,
      reproductionSteps,
    });

    const requirement = await this.prisma.requirement.create({
      data: {
        projectId,
        workspaceId: bug.workspaceId,
        title: payload.title,
        description: payload.description,
        acceptanceCriteria: payload.acceptanceCriteria,
      },
    });

    await this.prisma.bug.update({
      where: { id: bug.id },
      data: { fixRequirementId: requirement.id, projectId },
    });

    return requirement;
  }

  private async ensureDefaultBugFixProject(workspaceId: string) {
    const existing = await this.prisma.project.findFirst({
      where: {
        workspaceId,
        status: 'ACTIVE',
        name: '缺陷修复',
      },
    });
    if (existing) {
      return existing.id;
    }

    const project = await this.prisma.project.create({
      data: {
        workspaceId,
        name: '缺陷修复',
        description: '用于缺陷修复工作流的默认项目',
      },
    });
    return project.id;
  }

  private async applyBugFixBootstrap(
    tx: Prisma.TransactionClient,
    workflowId: string,
    bug: {
      title: string;
      description: string;
      expectedBehavior: string | null;
      actualBehavior: string | null;
      reproductionSteps: Prisma.JsonValue;
    },
    repositoryNames: string[],
  ) {
    if (!this.stateMachine.canBootstrapBugFixWorkflow(WorkflowRunType.BUG_FIX)) {
      throw new BadRequestException('缺陷修复工作流 bootstrap 不可用。');
    }

    const reproductionSteps = Array.isArray(bug.reproductionSteps)
      ? bug.reproductionSteps.map(String)
      : [];
    const bugPayload: BugFixPayload = {
      title: bug.title,
      description: bug.description,
      expectedBehavior: bug.expectedBehavior,
      actualBehavior: bug.actualBehavior,
      reproductionSteps,
    };

    let workflowStatus = WorkflowRunStatus.BRAINSTORM_PENDING;
    workflowStatus = await this.applyBootstrapStageSkip(tx, workflowId, StageType.BRAINSTORM, workflowStatus);
    workflowStatus = await this.applyBootstrapStageSkip(tx, workflowId, StageType.DESIGN, workflowStatus);
    workflowStatus = await this.applyBootstrapStageSkip(tx, workflowId, StageType.DEMO, workflowStatus);

    const taskPayload = buildBugFixTask(bugPayload, repositoryNames);
    const taskSplitStage = await this.createStageExecution(tx, workflowId, StageType.TASK_SPLIT, {
      input: { bugId: workflowId, source: 'bug_fix_bootstrap' },
      status: StageExecutionStatus.WAITING_CONFIRMATION,
      statusMessage: '缺陷修复工作流已预置任务',
      finishedAt: new Date(),
    });

    await tx.task.create({
      data: {
        workflowRunId: workflowId,
        title: taskPayload.title,
        description: taskPayload.description,
        surface: taskPayload.surface,
        repositoryNames: taskPayload.repositoryNames,
        order: 0,
        status: 'CONFIRMED',
      },
    });

    await this.updateStageExecution(tx, taskSplitStage.id, StageExecutionStatus.COMPLETED, {
      finishedAt: new Date(),
    });

    await this.transitionWorkflow(tx, workflowId, WorkflowRunStatus.TASK_SPLIT_PENDING, {
      to: WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION,
      stage: StageType.TASK_SPLIT,
    });
    await this.transitionWorkflow(tx, workflowId, WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION, {
      to: WorkflowRunStatus.TASK_SPLIT_CONFIRMED,
    });
    await this.transitionWorkflow(tx, workflowId, WorkflowRunStatus.TASK_SPLIT_CONFIRMED, {
      to: WorkflowRunStatus.PLAN_PENDING,
      stage: StageType.TECHNICAL_PLAN,
    });

    const planContent = buildBugFixPlanContent(bugPayload);
    await tx.plan.create({
      data: {
        workflowRunId: workflowId,
        status: 'CONFIRMED',
        summary: planContent.summary,
        implementationPlan: planContent.implementationPlan,
        filesToModify: planContent.filesToModify,
        newFiles: planContent.newFiles,
        riskPoints: planContent.riskPoints,
      },
    });

    await this.createStageExecution(tx, workflowId, StageType.TECHNICAL_PLAN, {
      input: { source: 'bug_fix_bootstrap' },
      output: planContent,
      status: StageExecutionStatus.COMPLETED,
      statusMessage: '缺陷修复工作流已预置技术方案',
      finishedAt: new Date(),
    });

    await this.transitionWorkflow(tx, workflowId, WorkflowRunStatus.PLAN_PENDING, {
      to: WorkflowRunStatus.PLAN_WAITING_CONFIRMATION,
      stage: StageType.TECHNICAL_PLAN,
    });
    await this.transitionWorkflow(tx, workflowId, WorkflowRunStatus.PLAN_WAITING_CONFIRMATION, {
      to: WorkflowRunStatus.PLAN_CONFIRMED,
    });
    await this.transitionWorkflow(tx, workflowId, WorkflowRunStatus.PLAN_CONFIRMED, {
      to: WorkflowRunStatus.EXECUTION_PENDING,
      stage: StageType.EXECUTION,
    });
  }

  private async applyLocalChatBootstrap(
    tx: Prisma.TransactionClient,
    workflow: {
      id: string;
      requirement: {
        id: string;
        title: string;
        description: string;
        acceptanceCriteria: string;
      };
    },
    repositoryNames: string[],
  ) {
    if (!this.stateMachine.canBootstrapLocalChatWorkflow(WorkflowRunType.LOCAL_CHAT)) {
      throw new BadRequestException('本地 Chat 工作流 bootstrap 不可用。');
    }

    let workflowStatus = WorkflowRunStatus.BRAINSTORM_PENDING;
    const skipOptions = {
      source: 'local_chat_bootstrap',
      label: '本地 Chat 工作流',
    };
    workflowStatus = await this.applyBootstrapStageSkip(
      tx,
      workflow.id,
      StageType.BRAINSTORM,
      workflowStatus,
      skipOptions,
    );
    workflowStatus = await this.applyBootstrapStageSkip(
      tx,
      workflow.id,
      StageType.DESIGN,
      workflowStatus,
      skipOptions,
    );
    workflowStatus = await this.applyBootstrapStageSkip(
      tx,
      workflow.id,
      StageType.DEMO,
      workflowStatus,
      skipOptions,
    );

    const bootstrap = buildLocalChatRequirementBootstrap(workflow.requirement);
    const taskSplitStage = await this.createStageExecution(tx, workflow.id, StageType.TASK_SPLIT, {
      input: { requirementId: workflow.requirement.id, source: 'local_chat_bootstrap' },
      status: StageExecutionStatus.WAITING_CONFIRMATION,
      statusMessage: '本地 Chat 工作流已预置任务',
      finishedAt: new Date(),
    });

    await tx.task.create({
      data: {
        workflowRunId: workflow.id,
        title: bootstrap.task.title,
        description: bootstrap.task.description,
        surface: bootstrap.task.surface,
        repositoryNames,
        order: 0,
        status: 'CONFIRMED',
      },
    });

    await this.updateStageExecution(tx, taskSplitStage.id, StageExecutionStatus.COMPLETED, {
      finishedAt: new Date(),
    });

    await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.TASK_SPLIT_PENDING, {
      to: WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION,
      stage: StageType.TASK_SPLIT,
    });
    await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION, {
      to: WorkflowRunStatus.TASK_SPLIT_CONFIRMED,
    });
    await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.TASK_SPLIT_CONFIRMED, {
      to: WorkflowRunStatus.PLAN_PENDING,
      stage: StageType.TECHNICAL_PLAN,
    });

    await tx.plan.create({
      data: {
        workflowRunId: workflow.id,
        status: 'CONFIRMED',
        summary: bootstrap.plan.summary,
        implementationPlan: bootstrap.plan.implementationPlan,
        filesToModify: bootstrap.plan.filesToModify,
        newFiles: bootstrap.plan.newFiles,
        riskPoints: bootstrap.plan.riskPoints,
      },
    });

    await this.createStageExecution(tx, workflow.id, StageType.TECHNICAL_PLAN, {
      input: { source: 'local_chat_bootstrap' },
      output: bootstrap.plan,
      status: StageExecutionStatus.COMPLETED,
      statusMessage: '本地 Chat 工作流已预置技术方案',
      finishedAt: new Date(),
    });

    await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.PLAN_PENDING, {
      to: WorkflowRunStatus.PLAN_WAITING_CONFIRMATION,
      stage: StageType.TECHNICAL_PLAN,
    });
    await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.PLAN_WAITING_CONFIRMATION, {
      to: WorkflowRunStatus.PLAN_CONFIRMED,
    });
    await this.transitionWorkflow(tx, workflow.id, WorkflowRunStatus.PLAN_CONFIRMED, {
      to: WorkflowRunStatus.EXECUTION_PENDING,
      stage: StageType.EXECUTION,
    });
  }

  private async applyBootstrapStageSkip(
    tx: Prisma.TransactionClient,
    workflowId: string,
    stage: StageType,
    fromStatus: WorkflowRunStatus,
    options: { source: string; label: string } = {
      source: 'bug_fix_bootstrap',
      label: '缺陷修复工作流',
    },
  ): Promise<WorkflowRunStatus> {
    const skipTarget = this.resolveOptionalStageSkipTarget(stage);
    const stageExecution = await this.createStageExecution(tx, workflowId, stage, {
      status: StageExecutionStatus.PENDING,
      statusMessage: `${options.label}跳过该阶段`,
    });
    await this.updateStageExecution(tx, stageExecution.id, StageExecutionStatus.SKIPPED, {
      output: this.buildSkippedStageOutput(skipTarget.reason),
      statusMessage: `已跳过，${options.label}继续`,
      finishedAt: new Date(),
    });
    await this.transitionWorkflow(tx, workflowId, fromStatus, {
      to: skipTarget.to,
      stage: skipTarget.nextStage ?? undefined,
    });
    if (skipTarget.pendingStage) {
      await this.createStageExecution(tx, workflowId, skipTarget.pendingStage, {
        input: {
          workflowRunId: workflowId,
          previousStage: stageTypeMap[stage],
          source: options.source,
        },
        status: StageExecutionStatus.PENDING,
        statusMessage: skipTarget.pendingStatusMessage,
      });
    }
    return skipTarget.to;
  }

  private getReviewFindingStatusAfterFix(): string {
    return 'FIXED_PENDING_REVIEW';
  }

  private canRunReviewFromStatus(status: string): boolean {
    return status === 'REVIEW_PENDING' || status === 'HUMAN_REVIEW_PENDING' || status === 'DONE';
  }

  private fromPrismaStageStatus(status: string): StageExecutionStatus {
    const entry = Object.entries(stageStatusMap).find(([, value]) => value === status);
    if (!entry) {
      throw new BadRequestException(`Unsupported stage status: ${status}`);
    }
    return entry[0] as StageExecutionStatus;
  }

  private resolveAiExecutor(provider?: string | null): AIExecutor {
    return this.aiExecutorRegistry.get(this.aiInvocationContextService.normalizeAiProvider(provider));
  }

  private getAiProviderLabel(provider?: string | null) {
    return this.aiInvocationContextService.normalizeAiProvider(provider) === 'cursor' ? 'Cursor' : 'Codex';
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
      flowxOrganizationId: session.organization?.id ?? null,
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
      flowxOrganizationId:
        typeof candidate.flowxOrganizationId === 'string'
          ? candidate.flowxOrganizationId
          : null,
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

  private async headCommitMatchesMessage(cwd: string, commitMessage: string) {
    const { stdout } = await this.runGit(['log', '-1', '--pretty=%s'], cwd);
    return stdout === commitMessage;
  }

  private async getHeadSha(cwd: string) {
    const { stdout } = await this.runGit(['rev-parse', 'HEAD'], cwd);
    return stdout;
  }

  private async getRemoteUrl(cwd: string, remoteName: string) {
    const { stdout } = await this.runGit(['remote', 'get-url', remoteName], cwd);
    return stdout;
  }

  private async remoteBranchExists(cwd: string, remote: string, branchName: string) {
    const { stdout } = await this.runGit(['ls-remote', '--heads', remote, branchName], cwd);
    return stdout.trim().length > 0;
  }

  private async resolvePublishRemoteUrl(repository: {
    repository: string;
    localPath: string;
    remoteUrl?: string | null;
  }) {
    const candidate = repository.remoteUrl?.trim();
    if (candidate && !this.isLocalGitRemote(candidate)) {
      return candidate;
    }

    const originUrl = await this.getRemoteUrl(repository.localPath, 'origin');
    if (this.isLocalGitRemote(originUrl)) {
      throw new BadRequestException(
        `代码库 ${repository.repository} 的 origin 指向本地镜像路径 ${originUrl}，且工作流记录中没有可用的真实远端地址。`,
      );
    }

    return originUrl;
  }

  private isLocalGitRemote(remote: string) {
    const value = remote.trim();
    if (!value) {
      return true;
    }

    return (
      value.startsWith('/') ||
      value.startsWith('./') ||
      value.startsWith('../') ||
      value.startsWith('file://')
    );
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

export type WorkflowPayload = Prisma.WorkflowRunGetPayload<{
  include: {
    requirement: {
      include: {
        project: {
          include: {
            workspace: true;
          };
        };
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

export type LocalExecutionSessionProjection = {
  id: string;
  status: string;
  sourceTool: string;
  traceId: string;
  protocolVersion: string;
  metadata: Prisma.JsonValue | null;
};

type WorkflowNotificationSession = {
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
