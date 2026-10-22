import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowRunStatus, WorkflowRunType } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_EXECUTION_SESSION_STATUSES } from '../execution-sessions/execution-session-state';
import {
  resolveLocalPosition,
  summarizePriorOutputs,
  type WorkflowPositionArtifactRef,
  type WorkflowPositionPriorOutput,
} from './workflow-position';

export type EdgeTaskType = 'requirement' | 'bug';

export type EdgeWorkflowSession = {
  user: { id: string; displayName: string };
  organization?: {
    id?: string | null;
    providerOrganizationId?: string | null;
    name?: string | null;
  } | null;
};

export interface EdgeTaskItem {
  id: string;
  type: EdgeTaskType;
  title: string;
  status: string;
  priority?: string | null;
  scheduleSignal?: string | null;
  repository: { id: string; name: string; url: string | null } | null;
  workflowRunId: string | null;
  executionSessionId?: string | null;
  workflowStage?: 'SPEC_PLAN' | 'EXECUTION' | null;
  eligible: boolean;
  ineligibleReason?: string;
}

export interface WorkflowPositionSessionRef {
  id: string;
  status: string;
  stageExecutionId: string | null;
  claimedByUserId: string | null;
  claimedByUser: { id: string; displayName: string } | null;
}

export interface WorkflowPositionItem {
  workflowRunId: string;
  requirementId: string;
  title: string;
  status: string;
  localAction: ReturnType<typeof resolveLocalPosition>['localAction'];
  stage: ReturnType<typeof resolveLocalPosition>['stage'];
  message: string;
  outputContract: ReturnType<typeof resolveLocalPosition>['outputContract'];
  executionSession: WorkflowPositionSessionRef | null;
  priorOutputs: WorkflowPositionPriorOutput[];
  artifacts: WorkflowPositionArtifactRef[];
}

export type OpenDesignSuggestedAction = 'brainstorm' | 'design';

export interface OpenDesignWorkflowItem {
  kind: 'opendesign-workflow';
  workflowRunId: string;
  requirementId: string;
  title: string;
  status: string;
  suggestedAction: OpenDesignSuggestedAction;
}

const OPEN_DESIGN_CANDIDATE_STATUSES = ['BRAINSTORM_PENDING', 'DESIGN_PENDING'] as const;

@Injectable()
export class EdgeTasksService {
  constructor(private readonly prisma: PrismaService) {}

  async listTasks(filters: {
    workspaceId?: string;
    session?: EdgeWorkflowSession;
  }): Promise<EdgeTaskItem[]> {
    const workspaceFilter = filters.workspaceId?.trim()
      ? { workspaceId: filters.workspaceId.trim() }
      : {};
    const [requirements, bugs] = await Promise.all([
      this.prisma.requirement.findMany({
        where: { status: 'ACTIVE', ...workspaceFilter },
        include: {
          requirementRepositories: {
            include: { repository: true },
            orderBy: { createdAt: 'asc' },
          },
          workflowRuns: {
            include: {
              workflowRepositories: true,
              executionSessions: {
                select: { id: true, sourceTool: true, status: true, metadata: true },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.bug.findMany({
        where: { status: { in: ['OPEN', 'CONFIRMED'] }, ...workspaceFilter },
        include: { repository: true, fixWorkflowRun: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return [
      ...requirements.map((requirement) => {
        const repository = requirement.requirementRepositories[0]?.repository ?? null;
        const localWorkflow = requirement.workflowRuns.find((workflow) => this.isReportableLocalWorkflow(workflow));
        const localSpecPlanWorkflow = requirement.workflowRuns.find((workflow) =>
          this.isReportableLocalSpecPlanWorkflow(workflow),
        );
        const localExecutionWorkflow = localWorkflow ?? localSpecPlanWorkflow;
        const activeWorkflow =
          localExecutionWorkflow ??
          requirement.workflowRuns.find((workflow) => this.isActiveWorkflow(workflow));
        return this.buildTaskItem({
          id: requirement.id,
          type: 'requirement',
          title: requirement.title,
          status: requirement.status,
          priority: requirement.priority,
          scheduleSignal: requirement.planningStatus,
          repository,
          workflowRunId: localExecutionWorkflow?.id ?? null,
          executionSessionId:
            localExecutionWorkflow?.executionSessions?.find((session) => this.isLocalSession(session))?.id ?? null,
          workflowStage: localWorkflow ? 'EXECUTION' : localSpecPlanWorkflow ? 'SPEC_PLAN' : null,
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
          workflowRunId:
            activeFixWorkflow && this.isReportableLocalWorkflow(activeFixWorkflow) ? activeFixWorkflow.id : null,
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

  async listWorkflowPositions(filters: {
    workspaceId?: string;
    workflowRunId?: string;
    session?: EdgeWorkflowSession;
  }): Promise<WorkflowPositionItem[]> {
    const workspaceId = filters.workspaceId?.trim() || undefined;
    const workflowRunId = filters.workflowRunId?.trim() || undefined;
    const organizationId = filters.session?.organization?.id?.trim() || undefined;
    const workflows = await this.prisma.workflowRun.findMany({
      where: {
        ...(workflowRunId ? { id: workflowRunId } : { status: { notIn: ['DONE', 'FAILED'] } }),
        ...(workspaceId || organizationId ? { requirement: {
          ...(workspaceId ? { workspaceId } : {}),
          ...(organizationId ? { project: { workspace: { organizationId } } } : {}),
        } } : {}),
      },
      include: {
        requirement: { select: { id: true, title: true } },
        stageExecutions: {
          select: { id: true, stage: true, status: true, attempt: true, input: true, output: true },
        },
        executionSessions: {
          where: {
            status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] },
            ...(organizationId ? { OR: [{ organizationId }, { organizationId: null }] } : {}),
          },
          select: {
            id: true, status: true, stageExecutionId: true, claimedByUserId: true,
            claimedByUser: { select: { id: true, displayName: true } },
            organizationId: true, metadata: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        artifacts: {
          where: {
            status: 'AVAILABLE',
            artifactType: { in: ['SPEC_MARKDOWN', 'PLAN_MARKDOWN', 'DESIGN_HTML'] },
            ...(organizationId ? { workspace: { organizationId } } : {}),
          },
          select: {
            id: true, artifactType: true, name: true,
            storageKey: true, version: true, metadata: true,
            executionSession: { select: { stageExecutionId: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (workflowRunId && workflows.length === 0) {
      throw new NotFoundException(`Workflow ${workflowRunId} was not found.`);
    }
    return workflows.map((workflow) => {
      let position = resolveLocalPosition(workflow.status);
      const executionStage = [...workflow.stageExecutions].filter((stage) => stage.stage === 'EXECUTION')
        .sort((left, right) => right.attempt - left.attempt)[0];
      const executionInput = executionStage?.input;
      if (position.stage === 'execution' && executionInput && typeof executionInput === 'object' && !Array.isArray(executionInput) && executionInput.executor === 'CODE_DELIVERY') {
        position = { ...position, localAction: 'none', outputContract: null,
          message: '当前采用多人分支交付，请按共享方案自行开发并推送，再到网页提交仓库与分支；无需领取整个需求。' };
      }

      const executionSession = this.currentPositionSession(
        workflow.stageExecutions, workflow.executionSessions ?? [], position.stage, organizationId,
      );
      if (position.localAction === 'generate' && executionSession &&
          (!executionSession.claimedByUserId || executionSession.claimedByUserId !== filters.session?.user.id?.trim())) {
        position = {
          ...position,
          localAction: 'none',
          outputContract: null,
          message: executionSession.claimedByUserId
            ? `等待当前执行人 ${executionSession.claimedByUser?.displayName || executionSession.claimedByUserId} 完成并回传。`
            : '当前会话未记录执行人，请等待组织管理员确认原任务已停止后恢复交接。',
        };
      }
      const priorOutputs = summarizePriorOutputs(workflow.stageExecutions);
      const artifacts = workflow.artifacts.filter((artifact) => {
        const stage = artifact.artifactType === 'DESIGN_HTML' ? 'design' : 'spec-plan';
        const confirmed = priorOutputs.find((output) => output.stage === stage);
        if (!confirmed) return false;
        const confirmedStage = workflow.stageExecutions.find((item) => item.id === confirmed.stageExecutionId);
        // 部分端更新会显式保留旧会话页面，以当前已确认清单为准。
        const matchesCurrentInventory = artifact.artifactType === 'DESIGN_HTML' &&
          this.matchesDesignInventory(artifact, confirmedStage?.output);
        if (matchesCurrentInventory) return true;
        const stageExecutionId = artifact.executionSession?.stageExecutionId;
        if (stageExecutionId) return stageExecutionId === confirmed.stageExecutionId;
        if (artifact.artifactType === 'DESIGN_HTML') return false;
        // 未关联执行会话的历史文件无法在重试后证明版本，只兼容首个已确认 attempt。
        return confirmedStage?.attempt === 1;
      }).map(({ id, artifactType, name }) => ({ id, artifactType, name }));
      return {
        workflowRunId: workflow.id,
        requirementId: workflow.requirement.id,
        title: workflow.requirement.title,
        status: workflow.status,
        localAction: position.localAction,
        stage: position.stage,
        message: position.message,
        outputContract: position.outputContract,
        executionSession: executionSession ? {
          id: executionSession.id,
          status: executionSession.status,
          stageExecutionId: executionSession.stageExecutionId,
          claimedByUserId: executionSession.claimedByUserId,
          claimedByUser: executionSession.claimedByUser,
        } : null,
        priorOutputs,
        artifacts,
      };
    });
  }

  private matchesDesignInventory(
    artifact: { storageKey: string | null; version: string; metadata: unknown },
    output: unknown,
  ): boolean {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
    const surfaces = (output as Record<string, unknown>).surfaces;
    if (!Array.isArray(surfaces)) return false;
    return surfaces.some((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const surface = item as Record<string, unknown>;
      if (typeof surface.id !== 'string' || !surface.id || !Array.isArray(surface.pages)) return false;
      return surface.pages.some((pageItem: unknown) => {
        if (!pageItem || typeof pageItem !== 'object' || Array.isArray(pageItem)) return false;
        const page = pageItem as Record<string, unknown>;
        // 设计生成器未关联执行会话，使用当前确认清单中的实际文件路径证明归属。
        if (typeof page.relPath === 'string' && page.relPath && artifact.storageKey) {
          return artifact.storageKey === `design/${page.relPath}`;
        }
        // 旧清单缺路径时必须同时匹配生成批次、端和页面，不能只凭时间纳入其他页面。
        const generatedAt = this.readMetadataString(artifact.metadata, 'generatedAt') || artifact.version;
        return typeof page.generatedAt === 'string' && !!page.generatedAt &&
          generatedAt === page.generatedAt &&
          this.readMetadataString(artifact.metadata, 'surfaceId') === surface.id &&
          typeof page.id === 'string' && !!page.id &&
          this.readMetadataString(artifact.metadata, 'pageId') === page.id;
      });
    });
  }

  private currentPositionSession(
    stages: Array<{ id: string; stage: string; status: string; attempt: number }>,
    sessions: Array<WorkflowPositionSessionRef & { organizationId: string | null; metadata: unknown }>,
    stage: WorkflowPositionItem['stage'],
    organizationId?: string,
  ) {
    if (!stage) return null;
    const stageType = stage.replace('-', '_').toUpperCase();
    const latest = stages.filter((item) => item.stage.toUpperCase() === stageType)
      .sort((left, right) => right.attempt - left.attempt)[0];
    if (latest && ['COMPLETED', 'FAILED', 'REJECTED', 'SKIPPED'].includes(latest.status.toUpperCase())) {
      return null;
    }
    return sessions.find((session) => {
      if (!ACTIVE_EXECUTION_SESSION_STATUSES.some((status) => status === session.status.toUpperCase())) return false;
      if (organizationId && session.organizationId && session.organizationId !== organizationId) return false;
      if (session.stageExecutionId) return session.stageExecutionId === latest?.id;
      // 旧协议未关联 StageExecution 时仅兼容首个 attempt，不能占用重试后的阶段。
      return (!latest || latest.attempt === 1) &&
        this.readMetadataString(session.metadata, 'stage')?.toUpperCase() === stageType;
    }) ?? null;
  }

  async listOpenDesignTasks(filters: {
    workspaceId?: string;
    session?: EdgeWorkflowSession;
  }): Promise<OpenDesignWorkflowItem[]> {
    const workspaceId = filters.workspaceId?.trim() || undefined;
    const organizationId = filters.session?.organization?.id?.trim() || undefined;

    const workflows = await this.prisma.workflowRun.findMany({
      where: {
        runType: {
          in: [WorkflowRunType.LOCAL_DESIGN, WorkflowRunType.FULL],
        },
        status: { in: [...OPEN_DESIGN_CANDIDATE_STATUSES] },
        ...(workspaceId ? { requirement: { workspaceId } } : {}),
        ...(organizationId
          ? {
              OR: [
                { executionSessions: { none: {} } },
                { executionSessions: { some: { organizationId } } },
              ],
            }
          : {}),
      },
      include: {
        requirement: {
          select: { id: true, title: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return workflows.map((workflow) => ({
      kind: 'opendesign-workflow' as const,
      workflowRunId: workflow.id,
      requirementId: workflow.requirementId,
      title: workflow.requirement.title,
      status: workflow.status,
      suggestedAction: this.suggestedOpenDesignAction(workflow.status),
    }));
  }

  private suggestedOpenDesignAction(status: string): OpenDesignSuggestedAction {
    return status.toLowerCase() === WorkflowRunStatus.BRAINSTORM_PENDING ? 'brainstorm' : 'design';
  }

  private isActiveWorkflow(workflow: { status: string }) {
    const status = workflow.status.toLowerCase();
    return ![WorkflowRunStatus.DONE, WorkflowRunStatus.FAILED].includes(
      status as WorkflowRunStatus,
    );
  }

  private isReportableLocalWorkflow(workflow: { runType?: string | null; status: string }) {
    return (
      workflow.runType === WorkflowRunType.LOCAL_CHAT &&
      workflow.status.toLowerCase() === WorkflowRunStatus.EXECUTION_RUNNING
    );
  }

  private isReportableLocalSpecPlanWorkflow(workflow: {
    status: string;
    executionSessions?: Array<{ sourceTool?: string | null; status?: string | null; metadata?: unknown }>;
  }) {
    return (
      workflow.status.toLowerCase() === WorkflowRunStatus.SPEC_PLAN_PENDING &&
      workflow.executionSessions?.some((session) =>
        this.isLocalSession(session) && this.readMetadataString(session.metadata, 'stage') === 'SPEC_PLAN',
      ) === true
    );
  }

  private isLocalSession(session: { sourceTool?: string | null; status?: string | null }) {
    return session.sourceTool === 'flowx-local' && session.status?.toUpperCase() === 'RUNNING';
  }

  private readMetadataString(metadata: unknown, key: string) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === 'string' ? value.trim() : null;
  }

  private buildTaskItem(input: Omit<EdgeTaskItem, 'priority' | 'scheduleSignal' | 'repository'> & {
    priority?: string | null;
    scheduleSignal?: string | null;
    repository: { id: string; name: string; url: string | null } | null;
  }): EdgeTaskItem {
    return {
      ...input,
      priority: input.priority ?? null,
      scheduleSignal: input.scheduleSignal ?? null,
      repository: input.repository
        ? { id: input.repository.id, name: input.repository.name, url: input.repository.url }
        : null,
      ...(input.ineligibleReason ? { ineligibleReason: input.ineligibleReason } : {}),
    };
  }
}
