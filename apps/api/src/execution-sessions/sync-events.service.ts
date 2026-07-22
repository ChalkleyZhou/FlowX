import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  validateSyncEvent,
  type ExecutionSessionStatus,
  type FlowXSyncEvent,
  type SyncEventType,
} from 'flowx-protocol';
import { PrismaService } from '../prisma/prisma.service';
import { AppendSyncEventDto } from './dto/append-sync-event.dto';
import {
  ExecutionSessionsService,
  type ExecutionSessionScope,
} from './execution-sessions.service';

const TERMINAL_EVENT_BY_STATUS: Partial<Record<ExecutionSessionStatus, SyncEventType>> = {
  COMPLETED: 'execution.completed',
  FAILED: 'execution.failed',
  CANCELLED: 'execution.cancelled',
};

@Injectable()
export class SyncEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executionSessionsService: ExecutionSessionsService,
  ) {}

  async append(
    executionSessionId: string,
    dto: AppendSyncEventDto,
    scope: ExecutionSessionScope = {},
  ) {
    const duplicate = await this.findDuplicate(dto.eventId, dto.idempotencyKey);
    if (duplicate) {
      this.assertMatchingDuplicate(duplicate, executionSessionId, dto);
      return duplicate;
    }

    const session = await this.executionSessionsService.requireAccessibleSession(
      executionSessionId,
      scope,
    );
    const event: FlowXSyncEvent = {
      eventId: dto.eventId,
      schemaVersion: dto.schemaVersion,
      executionSessionId,
      organizationId: session.organizationId ?? undefined,
      workspaceId: session.workspaceId ?? undefined,
      projectId: session.projectId ?? undefined,
      actorId: scope.userId ?? undefined,
      deviceId: dto.deviceId,
      sourceTool: dto.sourceTool,
      traceId: dto.traceId,
      entityType: dto.entityType,
      entityId: dto.entityId,
      eventType: dto.eventType,
      payload: dto.payload,
      occurredAt: dto.occurredAt,
      idempotencyKey: dto.idempotencyKey,
      sequence: dto.sequence,
    };
    const validation = validateSyncEvent(event);
    if (!validation.valid) {
      throw new BadRequestException({
        code: validation.errors.some((message) => message.startsWith('Unsupported schemaVersion'))
          ? 'PROTOCOL_VERSION_UNSUPPORTED'
          : 'SYNC_EVENT_INVALID',
        message: validation.errors.join('; '),
      });
    }
    this.assertTerminalEventAllowed(session.status as ExecutionSessionStatus, dto.eventType);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.syncEvent.create({
          data: {
            eventId: dto.eventId,
            executionSessionId,
            schemaVersion: dto.schemaVersion,
            sequence: dto.sequence,
            eventType: dto.eventType,
            sourceTool: dto.sourceTool,
            actorId: scope.userId ?? null,
            deviceId: dto.deviceId ?? null,
            traceId: dto.traceId,
            occurredAt: new Date(dto.occurredAt),
            idempotencyKey: dto.idempotencyKey,
            payload: toInputJson(dto.payload),
          },
        });

        if (
          dto.eventType === 'execution.heartbeat' ||
          dto.eventType === 'execution.progressed' ||
          dto.eventType === 'execution.started'
        ) {
          await tx.executionSession.update({
            where: { id: executionSessionId },
            data: { lastHeartbeatAt: new Date(dto.occurredAt) },
          });
        }
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrentDuplicate = await this.findDuplicate(dto.eventId, dto.idempotencyKey);
        if (concurrentDuplicate) {
          this.assertMatchingDuplicate(concurrentDuplicate, executionSessionId, dto);
          return concurrentDuplicate;
        }
      }
      throw error;
    }
  }

  async list(
    executionSessionId: string,
    options: { cursor?: string; take?: number } = {},
    scope: ExecutionSessionScope = {},
  ) {
    await this.executionSessionsService.requireAccessibleSession(executionSessionId, scope);
    const take = Math.min(Math.max(options.take ?? 50, 1), 100);
    const rows = await this.prisma.syncEvent.findMany({
      where: { executionSessionId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return {
      items,
      nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
    };
  }

  private findDuplicate(eventId: string, idempotencyKey: string) {
    return this.prisma.syncEvent.findFirst({
      where: { OR: [{ eventId }, { idempotencyKey }] },
    });
  }

  private assertMatchingDuplicate(
    duplicate: {
      executionSessionId: string;
      eventId: string;
      idempotencyKey: string;
      eventType: string;
    },
    executionSessionId: string,
    dto: AppendSyncEventDto,
  ) {
    if (
      duplicate.executionSessionId !== executionSessionId ||
      duplicate.eventId !== dto.eventId ||
      duplicate.idempotencyKey !== dto.idempotencyKey ||
      duplicate.eventType !== dto.eventType
    ) {
      throw new ConflictException({
        code: 'SYNC_EVENT_DUPLICATE',
        message: 'The event id or idempotency key is already used by another sync event.',
      });
    }
  }

  private assertTerminalEventAllowed(status: ExecutionSessionStatus, eventType: SyncEventType) {
    const terminalEvent = TERMINAL_EVENT_BY_STATUS[status];
    if (terminalEvent && terminalEvent !== eventType) {
      throw new BadRequestException({
        code: 'EXECUTION_SESSION_TERMINAL',
        message: `Execution session is already ${status}.`,
      });
    }
  }
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) {
    return {};
  }
  return value as Prisma.InputJsonValue;
}
