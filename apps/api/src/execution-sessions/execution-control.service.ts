import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { Prisma, type ExecutionSession } from '@prisma/client';
import {
  EXECUTION_HEARTBEAT_INTERVAL_MS, getExecutionHealth, isExecutionSessionTerminal,
  type ExecutionSessionStatus,
} from '@flowx-ai/protocol';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import { isOrganizationAdminRole } from '../auth/organization-role';
import type { ExecutionSessionScope } from './execution-sessions.service';
import type { AcknowledgeExecutionCommandDto, ExecutionCheckpointDto, ListExecutionSessionsDto, RequestExecutionCommandDto, RetryExecutionSessionDto } from './dto/execution-control.dto';

const pending = ['CREATED', 'DELIVERED'];
export type ControlScope = ExecutionSessionScope & { organizationRole?: string | null };
const accessibleInclude = { stageExecution: { select: { stage: true } }, workspace: { select: { organizationId: true } } } as const;
type ControlSession = ExecutionSession & { stageExecution: { stage: string } | null; workspace: { organizationId: string } | null };

@Injectable()
export class ExecutionControlService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WorkflowService)) private readonly workflow: WorkflowService,
  ) {}

  async list(filters: ListExecutionSessionsDto, scope: ControlScope) {
    const organizationId = this.requireOrganization(scope);
    if (filters.since && filters.until && new Date(filters.since) > new Date(filters.until)) {
      throw new BadRequestException('开始时间不能晚于结束时间。');
    }
    const take = Math.min(Math.max(filters.take ?? 30, 1), 100);
    const where: Prisma.ExecutionSessionWhereInput = {
      workspace: { organizationId },
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.workflowRunId ? { workflowRunId: filters.workflowRunId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.sourceTool ? { sourceTool: filters.sourceTool } : {}),
      ...(filters.since || filters.until ? { createdAt: {
        ...(filters.since ? { gte: new Date(filters.since) } : {}),
        ...(filters.until ? { lte: new Date(filters.until) } : {}),
      } } : {}),
    };
    // 游标也必须来自当前可见范围，不能使用其他组织的 ID 作为隐式边界。
    if (filters.cursor && !await this.prisma.executionSession.findFirst({ where: { ...where, id: filters.cursor } })) {
      throw new NotFoundException('执行会话游标不存在。');
    }
    const rows = await this.prisma.executionSession.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      include: { ...accessibleInclude, commands: { orderBy: { issuedAt: 'desc' }, take: 10 },
        workflowRun: { select: { requirement: { select: { title: true } } } },
        claimedByUser: { select: { displayName: true } } },
    });
    return { items: rows.slice(0, take).map((row) => ({ ...row, ...this.describe(row, scope) })),
      nextCursor: rows.length > take ? rows[take - 1].id : null };
  }

  describe(session: Pick<ControlSession, 'id' | 'status' | 'controlMode' | 'lastHeartbeatAt' | 'claimedByUserId' | 'cancelRequestedAt' | 'stageExecution'>, scope: ControlScope) {
    const canControl = Boolean(scope.userId && (scope.userId === session.claimedByUserId || isOrganizationAdminRole(scope.organizationRole)));
    return {
      health: getExecutionHealth(session),
      canControl: canControl && session.controlMode === 'COOPERATIVE' && session.stageExecution?.stage === 'EXECUTION',
      heartbeatIntervalMs: EXECUTION_HEARTBEAT_INTERVAL_MS,
    };
  }

  async request(id: string, input: RequestExecutionCommandDto, scope: ControlScope) {
    const session = await this.accessible(id, scope);
    this.assertController(session, scope);
    const key = input.idempotencyKey.trim();
    if (!key) throw new BadRequestException('idempotencyKey 不能为空。');
    return this.prisma.$transaction(async (tx) => {
      // 写入会话以序列化命令请求，完成入口也必须校验此会话。
      await this.lock(tx, session);
      const duplicate = await tx.executionCommand.findUnique({ where: { executionSessionId_idempotencyKey: { executionSessionId: id, idempotencyKey: key } } });
      if (duplicate) {
        if (duplicate.commandType !== input.commandType) throw new ConflictException('幂等键已用于其他命令。');
        return duplicate;
      }
      const current = await tx.executionSession.findUniqueOrThrow({ where: { id } });
      if (isExecutionSessionTerminal(current.status as ExecutionSessionStatus) || current.status === 'COMPLETING') {
        throw new BadRequestException('会话已结束或正在提交完成，不能下发控制命令。');
      }
      if (current.controlMode !== 'COOPERATIVE') throw new BadRequestException('请先让本地 Agent 使用新版 flowx-local 上报执行检查点。');
      if (input.commandType !== 'CANCEL' && current.cancelRequestedAt) throw new ConflictException('正在等待取消回执。');
      if (input.commandType === 'RESUME' && current.status !== 'BLOCKED') throw new BadRequestException('只能恢复处于阻塞状态的会话。');
      await this.expire(tx, id);
      const active = await tx.executionCommand.findFirst({ where: { executionSessionId: id, status: { in: pending } } });
      if (active?.commandType === input.commandType) return active;
      if (active && input.commandType !== 'CANCEL') throw new ConflictException('请先处理待回执命令。');
      if (input.commandType === 'CANCEL') {
        await tx.executionCommand.updateMany({ where: { executionSessionId: id, status: { in: pending } }, data: { status: 'EXPIRED' } });
        await tx.executionSession.updateMany({ where: { id, status: current.status }, data: { cancelRequestedAt: new Date() } });
      }
      return tx.executionCommand.create({ data: {
        executionSessionId: id, commandType: input.commandType, idempotencyKey: key,
        requestedByUserId: scope.userId!,
        // 取消命令持续有效，避免旧设备联网后继续工作。
        expiresAt: input.commandType === 'CANCEL' ? null : new Date(Date.now() + 30 * 60_000),
      } });
    });
  }

  async checkpoint(id: string, input: ExecutionCheckpointDto, scope: ControlScope) {
    const session = await this.accessible(id, scope);
    this.assertExecutor(session, input.deviceId, scope);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const terminal = isExecutionSessionTerminal(session.status as ExecutionSessionStatus);
        const blockedReason = input.blockedReason?.trim();
        if (input.blockedReason !== undefined && !blockedReason) throw new BadRequestException('阻塞原因不能为空。');
        if (blockedReason && !['RUNNING', 'BLOCKED'].includes(session.status)) throw new BadRequestException('当前会话不能上报阻塞。');
        if (!terminal && (session.controlMode !== 'COOPERATIVE' || blockedReason !== undefined ||
          !session.lastHeartbeatAt || Date.now() - session.lastHeartbeatAt.getTime() >= EXECUTION_HEARTBEAT_INTERVAL_MS)) {
          const update = await tx.executionSession.updateMany({
            where: { id, status: session.status, deviceId: session.deviceId, updatedAt: session.updatedAt },
            data: { controlMode: 'COOPERATIVE', deviceId: input.deviceId,
              activeControlDeviceKey: JSON.stringify([scope.organizationId, scope.userId, input.deviceId]),
              lastHeartbeatAt: new Date(),
              ...(blockedReason ? { status: 'BLOCKED', blockedReason } : {}),
            },
          });
          if (update.count !== 1) throw new ConflictException('会话已变化，请重新获取检查点。');
        }
        await this.expire(tx, id);
        await tx.executionCommand.updateMany({ where: { executionSessionId: id, status: 'CREATED' },
          data: { status: 'DELIVERED', deliveredAt: new Date() } });
        const commands = await tx.executionCommand.findMany({ where: { executionSessionId: id, status: 'DELIVERED' }, orderBy: { issuedAt: 'asc' } });
        const current = await tx.executionSession.findUniqueOrThrow({ where: { id } });
        return { session: current, commands, heartbeatIntervalMs: EXECUTION_HEARTBEAT_INTERVAL_MS };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('当前设备已有活动会话，请先完成或取消后再绑定。');
      }
      throw error;
    }
  }

  async acknowledge(id: string, commandId: string, input: AcknowledgeExecutionCommandDto, scope: ControlScope) {
    const session = await this.accessible(id, scope);
    this.assertExecutor(session, input.deviceId, scope);
    const command = await this.prisma.executionCommand.findUnique({ where: { id: commandId } });
    if (!command || command.executionSessionId !== id) throw new NotFoundException('控制命令不存在。');
    if (command.status === input.outcome) return command;
    if (command.status !== 'DELIVERED') throw new ConflictException('命令尚未领取或已经结束。');
    if (command.expiresAt && command.expiresAt.getTime() <= Date.now()) throw new ConflictException('控制命令已过期。');
    const acknowledge = async (tx: Prisma.TransactionClient) => {
      const changed = await tx.executionCommand.updateMany({ where: {
        id: commandId, executionSessionId: id, status: 'DELIVERED',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      }, data: { status: input.outcome, acknowledgedAt: new Date(), errorMessage: input.outcome === 'FAILED' ? input.message?.trim() || '本地未完成命令' : null } });
      if (changed.count !== 1) throw new ConflictException('命令已变化，请刷新后重试。');
    };
    if (command.commandType === 'CANCEL' && input.outcome === 'ACKED') {
      await this.workflow.cancelLocalExecution(session.workflowRunId!, { expectedSessionId: id, beforeCancel: acknowledge });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await acknowledge(tx);
        if (command.commandType === 'RESUME' && input.outcome === 'ACKED') {
          const update = await tx.executionSession.updateMany({ where: { id, status: 'BLOCKED', cancelRequestedAt: null }, data: { status: 'RUNNING', blockedReason: null, lastHeartbeatAt: new Date() } });
          if (update.count !== 1) throw new ConflictException('会话已不能恢复。');
        }
      });
    }
    return { ...command, status: input.outcome };
  }

  async retry(id: string, input: RetryExecutionSessionDto, scope: ControlScope) {
    const session = await this.accessible(id, scope);
    this.assertController(session, scope);
    if (!input.previousExecutionStopped) throw new BadRequestException('请先确认旧执行已在本地停止。');
    const key = `local-retry:${id}`;
    const existing = await this.prisma.executionSession.findUnique({ where: { idempotencyKey: key } });
    if (existing) return { executionSessionId: existing.id, workflowRunId: existing.workflowRunId };
    if (!['FAILED', 'CANCELLED'].includes(session.status) && getExecutionHealth(session) !== 'STALE') {
      throw new BadRequestException('只能重试失败、已取消或失联的执行会话。');
    }
    const workflow = await this.workflow.findOne(session.workflowRunId!);
    if (workflow.status === 'EXECUTION_RUNNING') {
      await this.workflow.cancelLocalExecution(session.workflowRunId!, {
        expectedSessionId: id,
        beforeCancel: async (tx) => {
          await tx.executionCommand.updateMany({ where: { executionSessionId: id, status: { in: pending } },
            data: { status: 'EXPIRED', errorMessage: '人工确认旧执行已停止并重新交接' } });
        },
      });
    } else if (workflow.status !== 'EXECUTION_PENDING') {
      throw new ConflictException('工作流已进入其他阶段，不能重新交接。');
    }
    const latest = await this.prisma.executionSession.findFirst({
      where: { workflowRunId: session.workflowRunId, executorType: 'LOCAL', stageExecution: { stage: 'EXECUTION' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (latest?.id !== id) throw new ConflictException('工作流已有更新的执行会话，请刷新后重新交接。');
    // 两个事务间中断时保持待执行；相同请求重试会复用唯一 claim key。
    const result = await this.workflow.claimLocalExecution(session.workflowRunId!, {
      user: { id: scope.userId!, displayName: scope.userId! }, organization: { id: scope.organizationId },
    }, input.sourceTool, key);
    return { executionSessionId: result.handoff.executionSessionId, workflowRunId: session.workflowRunId };
  }

  private async accessible(id: string, scope: ControlScope): Promise<ControlSession> {
    const organizationId = this.requireOrganization(scope);
    const session = await this.prisma.executionSession.findFirst({ where: { id, workspace: { organizationId } }, include: accessibleInclude });
    if (!session || session.workspace?.organizationId !== organizationId) throw new NotFoundException('执行会话不存在。');
    if (session.executorType !== 'LOCAL' || session.stageExecution?.stage !== 'EXECUTION') {
      throw new BadRequestException('当前仅支持本地开发执行的运行控制。');
    }
    return session;
  }

  private requireOrganization(scope: ControlScope) {
    if (!scope.organizationId?.trim() || !scope.userId?.trim()) throw new ForbiddenException('需要用户和组织上下文。');
    return scope.organizationId.trim();
  }
  private assertController(session: ControlSession, scope: ControlScope) {
    if (session.claimedByUserId !== scope.userId && !isOrganizationAdminRole(scope.organizationRole)) {
      throw new ForbiddenException('仅执行人或组织管理员可以控制会话。');
    }
  }
  private assertExecutor(session: ControlSession, deviceId: string, scope: ControlScope) {
    if (session.claimedByUserId !== scope.userId) throw new ForbiddenException('仅原执行人可以提交本地检查点和回执。');
    if (!deviceId.trim() || (session.deviceId && session.deviceId !== deviceId)) throw new ConflictException('会话已绑定其他设备。');
  }
  private async lock(tx: Prisma.TransactionClient, session: ControlSession) {
    const update = await tx.executionSession.updateMany({ where: { id: session.id, status: session.status, updatedAt: session.updatedAt }, data: { updatedAt: new Date() } });
    if (update.count !== 1) throw new ConflictException('会话已变化，请刷新后重试。');
  }
  private expire(tx: Prisma.TransactionClient, id: string) {
    return tx.executionCommand.updateMany({ where: { executionSessionId: id, status: { in: pending }, expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
  }
}
