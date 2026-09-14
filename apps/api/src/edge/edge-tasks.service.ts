import { Injectable } from '@nestjs/common';
import { WorkflowRunStatus, WorkflowRunType } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';

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
