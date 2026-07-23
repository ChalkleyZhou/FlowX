import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FLOWX_PROTOCOL_VERSION,
  isExecutionSessionTerminal,
  type ExecutionSessionStatus,
  type ExecutorType,
  type SourceTool,
} from '@flowx-ai/protocol';
import { PrismaService } from '../prisma/prisma.service';
import type { CompleteExecutionSessionDto } from './dto/complete-execution-session.dto';
import {
  ACTIVE_EXECUTION_SESSION_STATUSES,
  assertExecutionSessionTransition,
} from './execution-session-state';
import { WorkflowService } from '../workflow/workflow.service';

export type CompleteExecutionSessionScopeWithSession = ExecutionSessionScope & {
  notifySession?: {
    user: { id: string; displayName: string };
    organization?: {
      id?: string | null;
      providerOrganizationId?: string | null;
      name?: string | null;
    } | null;
  };
};

export type ExecutionSessionScope = {
  userId?: string | null;
  organizationId?: string | null;
};

export type CreateExecutionSessionInput = {
  workflowRunId: string;
  stageExecutionId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  deviceId?: string | null;
  status?: ExecutionSessionStatus;
  executorType: ExecutorType;
  sourceTool: SourceTool;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string | null;
  claimedByUserId?: string | null;
  startedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
};

type TransitionInput = {
  summary?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class ExecutionSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => WorkflowService))
    private readonly workflowService?: WorkflowService,
  ) {}

  async createOrReuseSession(input: CreateExecutionSessionInput) {
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await this.prisma.executionSession.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        this.assertMatchingCreateRequest(existing, input);
        return existing;
      }
    }

    if (input.stageExecutionId) {
      const active = await this.prisma.executionSession.findFirst({
        where: {
          stageExecutionId: input.stageExecutionId,
          status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (active) {
        throw new ConflictException({
          code: 'EXECUTION_SESSION_CONFLICT',
          message: `Stage execution ${input.stageExecutionId} already has an active execution session.`,
          executionSessionId: active.id,
        });
      }
    }

    const status = input.status ?? 'CREATED';
    return this.prisma.executionSession.create({
      data: {
        workflowRunId: input.workflowRunId,
        stageExecutionId: input.stageExecutionId ?? null,
        organizationId: input.organizationId ?? null,
        workspaceId: input.workspaceId ?? null,
        projectId: input.projectId ?? null,
        deviceId: input.deviceId ?? null,
        status,
        executorType: input.executorType,
        sourceTool: input.sourceTool,
        protocolVersion: input.protocolVersion ?? FLOWX_PROTOCOL_VERSION,
        traceId: input.traceId?.trim() || randomUUID(),
        idempotencyKey,
        claimedByUserId: input.claimedByUserId ?? null,
        startedAt: input.startedAt ?? (status === 'RUNNING' ? new Date() : null),
        metadata: toInputJson(input.metadata),
      },
    });
  }

  async findOne(id: string, scope: ExecutionSessionScope = {}) {
    const session = await this.prisma.executionSession.findUnique({
      where: { id },
      include: {
        syncEvents: {
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 100,
        },
        artifacts: { orderBy: { createdAt: 'desc' } },
        evidence: { orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] },
      },
    });
    if (!session) {
      throw new NotFoundException('Execution session not found.');
    }
    this.assertScope(session.organizationId, scope);
    return session;
  }

  async requireAccessibleSession(id: string, scope: ExecutionSessionScope = {}) {
    const session = await this.prisma.executionSession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('Execution session not found.');
    }
    this.assertScope(session.organizationId, scope);
    return session;
  }

  async markRunning(id: string, scope: ExecutionSessionScope = {}) {
    return this.transition(id, 'RUNNING', {}, scope);
  }

  async heartbeat(id: string, occurredAt: Date, scope: ExecutionSessionScope = {}) {
    const session = await this.requireAccessibleSession(id, scope);
    if (isExecutionSessionTerminal(session.status as ExecutionSessionStatus)) {
      throw new BadRequestException({
        code: 'EXECUTION_SESSION_TERMINAL',
        message: `Execution session ${id} is already ${session.status}.`,
      });
    }
    return this.prisma.executionSession.update({
      where: { id },
      data: { lastHeartbeatAt: occurredAt },
    });
  }

  /**
   * `POST /execution-sessions/:id/complete` (design spec §6.2). When `repositories` is
   * reported, this is the canonical local completion path: it delegates to
   * `WorkflowService.completeLocalExecutionBySession`, which runs the single
   * `LocalCompletionCommand` implementation (verify → artifacts → session terminal → workflow
   * advance) shared with the `complete-local` compatibility wrapper. Without `repositories`,
   * this keeps the original thin session status transition.
   */
  async complete(
    id: string,
    input: CompleteExecutionSessionDto = {},
    scope: CompleteExecutionSessionScopeWithSession = {},
  ) {
    if (input.repositories && input.repositories.length > 0) {
      if (typeof input.pushed !== 'boolean') {
        throw new BadRequestException('pushed is required when reporting repositories.');
      }
      if (!this.workflowService) {
        throw new BadRequestException('Local completion is not available in this environment.');
      }
      const result = await this.workflowService.completeLocalExecutionBySession(
        id,
        {
          idempotencyKey: input.idempotencyKey,
          repositories: input.repositories,
          pushed: input.pushed,
          implementationSummary: input.implementationSummary ?? input.summary,
          testResult: input.testResult,
          diffSummary: input.diffSummary,
          untrackedFiles: input.untrackedFiles,
        },
        scope.notifySession,
        { organizationId: scope.organizationId },
      );
      return result.executionSession;
    }
    return this.transition(id, 'COMPLETED', input, scope);
  }

  async fail(id: string, input: TransitionInput, scope: ExecutionSessionScope = {}) {
    return this.transition(id, 'FAILED', input, scope);
  }

  async cancel(id: string, input: TransitionInput = {}, scope: ExecutionSessionScope = {}) {
    return this.transition(id, 'CANCELLED', input, scope);
  }

  private async transition(
    id: string,
    to: ExecutionSessionStatus,
    input: TransitionInput,
    scope: ExecutionSessionScope,
  ) {
    const session = await this.requireAccessibleSession(id, scope);
    const from = session.status as ExecutionSessionStatus;
    if (from === to) {
      return session;
    }
    assertExecutionSessionTransition(from, to);

    const now = new Date();
    const result = await this.prisma.executionSession.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        startedAt: to === 'RUNNING' ? session.startedAt ?? now : undefined,
        completedAt: isExecutionSessionTerminal(to) ? now : undefined,
        summary: input.summary ?? undefined,
        errorCode: input.errorCode ?? undefined,
        errorMessage: input.errorMessage ?? undefined,
        metadata: toInputJson(input.metadata),
      },
    });
    if (result.count !== 1) {
      throw new ConflictException({
        code: 'EXECUTION_SESSION_CONFLICT',
        message: `Execution session ${id} changed while applying ${from} -> ${to}.`,
      });
    }
    return this.prisma.executionSession.findUniqueOrThrow({ where: { id } });
  }

  private assertMatchingCreateRequest(
    existing: {
      workflowRunId: string;
      stageExecutionId: string | null;
      executorType: string;
      sourceTool: string;
    },
    input: CreateExecutionSessionInput,
  ) {
    if (
      existing.workflowRunId !== input.workflowRunId ||
      existing.stageExecutionId !== (input.stageExecutionId ?? null) ||
      existing.executorType !== input.executorType ||
      existing.sourceTool !== input.sourceTool
    ) {
      throw new ConflictException({
        code: 'EXECUTION_SESSION_CONFLICT',
        message: 'The idempotency key is already used by another execution session request.',
      });
    }
  }

  private assertScope(sessionOrganizationId: string | null, scope: ExecutionSessionScope) {
    if (sessionOrganizationId && sessionOrganizationId !== scope.organizationId?.trim()) {
      throw new ForbiddenException('Execution session belongs to another organization.');
    }
  }
}

function toInputJson(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  return value == null ? undefined : (value as Prisma.InputJsonObject);
}
