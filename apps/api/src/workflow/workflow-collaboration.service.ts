import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canTransitionExecutionSession, getExecutionHealth, type ExecutionSessionStatus } from '@flowx-ai/protocol';
import { isOrganizationAdminRole } from '../auth/organization-role';
import { StageExecutionStatus } from '../common/enums';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { assertExecutionSessionTransition } from '../execution-sessions/execution-session-state';
import { PrismaService } from '../prisma/prisma.service';
import { ReleaseLocalTaskDto } from './dto/release-local-task.dto';

export type WorkflowCollaborationActor = {
  user: { id: string; displayName: string };
  organization?: { id?: string | null } | null;
};
const collaborationInclude = {
  requirement: { select: {
    workspace: { select: { id: true, organizationId: true } },
    project: { select: { workspace: { select: { id: true, organizationId: true } } } },
  } },
  stageExecutions: {
    orderBy: [{ attempt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    include: { executionSessions: {
      where: { executorType: 'LOCAL' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 1,
      include: { claimedByUser: { select: { displayName: true } } },
    } },
  },
} satisfies Prisma.WorkflowRunInclude;
type Workflow = Prisma.WorkflowRunGetPayload<{ include: typeof collaborationInclude }>;
type Stage = Workflow['stageExecutions'][number];
type Session = Stage['executionSessions'][number];
type Database = Prisma.TransactionClient;
type Scope = { userId: string; organizationId: string };
const releaseStages = new Set(['BRAINSTORM', 'DESIGN', 'SPEC_PLAN']);
const releaseEventType = 'execution.local_task_released';

@Injectable()
export class WorkflowCollaborationService {
  constructor(private readonly prisma: PrismaService, private readonly stateMachine: WorkflowStateMachine) {}

  async getCollaboration(id: string, actor?: WorkflowCollaborationActor) {
    const scope = this.scope(actor);
    const workflow = await this.accessible(this.prisma, id, scope);
    const admin = await this.isAdmin(this.prisma, scope);
    const sessions = this.latestStages(workflow).flatMap((stage) => {
      const session = stage.executionSessions.find((row) => row.executorType === 'LOCAL');
      if (!session) return [];
      this.assertSessionScope(session, workflow, scope);
      return [{
        id: session.id, stageExecutionId: stage.id, stage: stage.stage, status: session.status,
        sourceTool: session.sourceTool, health: getExecutionHealth(session), controlMode: session.controlMode,
        claimedByUser: session.claimedByUser, isOwner: session.claimedByUserId === scope.userId,
        canRelease: this.canRelease(workflow, stage, session) && this.mayRelease(session, scope, admin),
        lastHeartbeatAt: session.lastHeartbeatAt?.toISOString() ?? null,
        deviceId: session.deviceId, summary: session.summary, blockedReason: session.blockedReason, errorMessage: session.errorMessage,
      }];
    });
    return { workflowRunId: workflow.id, currentStage: workflow.currentStage, sessions };
  }

  async releaseLocalTask(id: string, input: ReleaseLocalTaskDto, actor?: WorkflowCollaborationActor) {
    const scope = this.scope(actor);
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    if (input?.confirmedStopped !== true || !reason || reason.length > 2000 || !input.executionSessionId?.trim()) {
      throw new BadRequestException('请确认已在原设备停止任务，并填写不超过 2000 字的交接原因。');
    }
    const executionSessionId = input.executionSessionId;
    const idempotencyKey = `local-task-release:${executionSessionId}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const workflow = await this.accessible(tx, id, scope);
        const session = await this.releaseSession(tx, executionSessionId, workflow, scope);
        const admin = await this.isAdmin(tx, scope);
        if (!this.mayRelease(session, scope, admin)) {
          throw new ForbiddenException('仅原执行人或同组织管理员可以结束本地任务；无执行人记录的历史任务仅允许管理员处理。');
        }
        const audit = await tx.syncEvent.findUnique({ where: { idempotencyKey } });
        if (session.status === 'CANCELLED' && audit?.executionSessionId === executionSessionId && audit.eventType === releaseEventType) {
          return { executionSessionId, released: true };
        }
        const stage = this.latestStages(workflow).find((row) => row.id === session.stageExecutionId);
        if (!stage || !this.canRelease(workflow, stage, session)) this.releaseConflict();

        // 与领取共用工作流写锁；显式递增，避免同毫秒更新时间未变化造成 CAS 穿透。
        const lockedAt = new Date(Math.max(Date.now(), workflow.updatedAt.getTime() + 1));
        const locked = await tx.workflowRun.updateMany({
          where: { id, updatedAt: workflow.updatedAt, status: workflow.status, currentStage: workflow.currentStage },
          data: { updatedAt: lockedAt },
        });
        if (locked.count !== 1) this.releaseConflict();
        const current = await this.accessible(tx, id, scope);
        const currentSession = await this.releaseSession(tx, executionSessionId, current, scope);
        const currentStage = this.latestStages(current).find((row) => row.id === currentSession.stageExecutionId);
        if (!currentStage || !this.canRelease(current, currentStage, currentSession)) this.releaseConflict();
        if (!this.mayRelease(currentSession, scope, admin)) throw new ForbiddenException('本地任务执行人已变化，请重新加载。');
        this.stateMachine.assertStageTransition(StageExecutionStatus.RUNNING, StageExecutionStatus.FAILED);
        assertExecutionSessionTransition(currentSession.status as ExecutionSessionStatus, 'CANCELLED');
        const completedAt = new Date();
        const summary = `已确认原设备停止，结束本次本地任务并重新交接：${reason}`;
        const cancelled = await tx.executionSession.updateMany({
          where: { id: executionSessionId, workflowRunId: id, stageExecutionId: currentStage.id,
            status: currentSession.status, updatedAt: currentSession.updatedAt, controlMode: currentSession.controlMode },
          data: { status: 'CANCELLED', activeControlDeviceKey: null, completedAt, summary },
        });
        if (cancelled.count !== 1) this.releaseConflict();
        const failed = await tx.stageExecution.updateMany({
          where: { id: currentStage.id, workflowRunId: id, status: currentStage.status },
          data: { status: 'FAILED', finishedAt: completedAt, errorMessage: summary, statusMessage: '本地任务已结束，可以重新领取。' },
        });
        if (failed.count !== 1) this.releaseConflict();
        await tx.syncEvent.create({ data: {
          eventId: randomUUID(), executionSessionId, schemaVersion: currentSession.protocolVersion,
          eventType: releaseEventType, sourceTool: currentSession.sourceTool, actorId: scope.userId,
          traceId: currentSession.traceId, occurredAt: completedAt, idempotencyKey,
          payload: { workflowRunId: id, stageExecutionId: currentStage.id, reason, confirmedStopped: true },
        } });
        return { executionSessionId, released: true };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2028', 'P2034', 'P1008'].includes(error.code)) {
        throw new ConflictException('本地任务状态正在变化，请重新加载后重试。');
      }
      throw error;
    }
  }

  private scope(actor?: WorkflowCollaborationActor): Scope {
    if (!actor?.user.id?.trim()) throw new UnauthorizedException('请先登录。');
    const organizationId = actor.organization?.id?.trim();
    if (!organizationId) throw new ForbiddenException('需要组织上下文。');
    return { userId: actor.user.id.trim(), organizationId };
  }

  private async accessible(db: Database, id: string, scope: Scope) {
    const workflow = await db.workflowRun.findUnique({ where: { id }, include: collaborationInclude });
    if (!workflow) throw new NotFoundException('工作流不存在。');
    if (this.workspace(workflow)?.organizationId !== scope.organizationId) throw new ForbiddenException('该工作流属于其他组织。');
    return workflow;
  }

  private async isAdmin(db: Database, scope: Scope) {
    const membership = await db.userOrganization.findUnique({ where: {
      userId_organizationId: { userId: scope.userId, organizationId: scope.organizationId },
    } });
    return !!membership && isOrganizationAdminRole(membership.role);
  }

  private latestStages(workflow: Workflow): Stage[] {
    const latest = new Map<string, Stage>();
    for (const stage of workflow.stageExecutions) {
      const previous = latest.get(stage.stage.toUpperCase());
      if (!previous || stage.attempt > previous.attempt ||
        (stage.attempt === previous.attempt && stage.createdAt > previous.createdAt)) latest.set(stage.stage.toUpperCase(), stage);
    }
    return [...latest.values()];
  }

  private mayRelease(session: Pick<Session, 'claimedByUserId'>, scope: Scope, admin: boolean) {
    return admin || (!!session.claimedByUserId && session.claimedByUserId === scope.userId);
  }

  private canRelease(workflow: Workflow, stage: Stage, session: Prisma.ExecutionSessionGetPayload<Record<string, never>>) {
    const name = stage.stage.toUpperCase();
    return releaseStages.has(name) && workflow.currentStage?.toUpperCase() === name && workflow.status.toUpperCase() === `${name}_PENDING` &&
      stage.status.toUpperCase() === 'RUNNING' && session.stageExecutionId === stage.id &&
      session.id === stage.executionSessions[0]?.id && session.executorType === 'LOCAL' && session.controlMode !== 'COOPERATIVE' &&
      canTransitionExecutionSession(session.status as ExecutionSessionStatus, 'CANCELLED');
  }

  private assertSessionScope(session: { organizationId: string | null; workspaceId: string | null }, workflow: Workflow, scope: Scope) {
    if ((session.organizationId && session.organizationId !== scope.organizationId) ||
      (session.workspaceId && session.workspaceId !== this.workspace(workflow)?.id)) throw new ForbiddenException('本地会话不属于该工作流的组织或工作区。');
  }

  private workspace(workflow: Workflow) {
    return workflow.requirement.workspace ?? workflow.requirement.project?.workspace;
  }

  private async releaseSession(db: Database, id: string, workflow: Workflow, scope: Scope) {
    const session = await db.executionSession.findUnique({ where: { id } });
    if (!session || session.workflowRunId !== workflow.id) throw new NotFoundException('工作流本地会话不存在。');
    this.assertSessionScope(session, workflow, scope);
    return session;
  }

  private releaseConflict(): never {
    throw new ConflictException('仅当前待执行阶段最新尝试的活动本地任务可以重新交接；支持协作控制的任务请使用现有停止入口。');
  }
}
