import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SyncEventsService } from './sync-events.service';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    eventId: 'event-1',
    executionSessionId: 'session-1',
    schemaVersion: '1.0',
    sequence: 1,
    eventType: 'execution.heartbeat',
    sourceTool: 'cursor',
    actorId: 'user-1',
    deviceId: 'device-1',
    traceId: 'trace-1',
    occurredAt: new Date('2026-07-22T00:00:00.000Z'),
    receivedAt: new Date('2026-07-22T00:00:01.000Z'),
    idempotencyKey: 'sync:session-1:execution.heartbeat:event-1',
    payload: {},
    ...overrides,
  };
}

function dto(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'event-1',
    schemaVersion: '1.0',
    sourceTool: 'cursor' as const,
    traceId: 'trace-1',
    entityType: 'execution-session',
    entityId: 'session-1',
    eventType: 'execution.heartbeat' as const,
    payload: {},
    occurredAt: '2026-07-22T00:00:00.000Z',
    idempotencyKey: 'sync:session-1:execution.heartbeat:event-1',
    deviceId: 'device-1',
    sequence: 1,
    ...overrides,
  };
}

function createService() {
  const prisma = {
    syncEvent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    executionSession: {
      update: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  };
  const executionSessionsService = {
    requireAccessibleSession: vi.fn().mockResolvedValue({
      id: 'session-1',
      status: 'RUNNING',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
    }),
  };
  return {
    service: new SyncEventsService(prisma as never, executionSessionsService as never),
    prisma,
    executionSessionsService,
  };
}

describe('SyncEventsService', () => {
  it('checks access before returning a duplicate event', async () => {
    const { service, prisma, executionSessionsService } = createService();
    prisma.syncEvent.findFirst.mockResolvedValue(event());
    executionSessionsService.requireAccessibleSession.mockRejectedValue(new ForbiddenException());
    await expect(service.append('session-1', dto())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not treat replayed events as cooperative execution checkpoints', async () => {
    const { service, prisma, executionSessionsService } = createService();
    executionSessionsService.requireAccessibleSession.mockResolvedValue({ id: 'session-1', status: 'RUNNING', controlMode: 'COOPERATIVE', claimedByUserId: 'user-1', deviceId: 'device-1' } as never);
    prisma.syncEvent.create.mockResolvedValue(event());
    await service.append('session-1', dto(), { userId: 'user-1', organizationId: 'org-1' });
    expect(prisma.executionSession.update).not.toHaveBeenCalled();
  });

  it('returns an identical duplicate without writing again', async () => {
    const { service, prisma } = createService();
    prisma.syncEvent.findFirst.mockResolvedValue(event());

    const result = await service.append('session-1', dto(), {
      userId: 'user-1',
      organizationId: 'org-1',
    });

    expect(result.id).toBe('row-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an event id reused with another payload identity', async () => {
    const { service, prisma } = createService();
    prisma.syncEvent.findFirst.mockResolvedValue(event({ executionSessionId: 'session-2' }));

    await expect(service.append('session-1', dto())).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects unsupported protocol versions', async () => {
    const { service, prisma } = createService();
    prisma.syncEvent.findFirst.mockResolvedValue(null);

    await expect(service.append('session-1', dto({ schemaVersion: '2.0' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('stores a heartbeat and updates the session heartbeat in one transaction', async () => {
    const { service, prisma } = createService();
    prisma.syncEvent.findFirst.mockResolvedValue(null);
    prisma.syncEvent.create.mockResolvedValue(event());
    prisma.executionSession.update.mockResolvedValue({});

    await service.append('session-1', dto(), {
      userId: 'user-1',
      organizationId: 'org-1',
    });

    expect(prisma.syncEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          executionSessionId: 'session-1',
          eventType: 'execution.heartbeat',
          actorId: 'user-1',
        }),
      }),
    );
    expect(prisma.executionSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { lastHeartbeatAt: expect.any(Date) },
    });
  });

  it('rejects new progress events after completion', async () => {
    const { service, prisma, executionSessionsService } = createService();
    prisma.syncEvent.findFirst.mockResolvedValue(null);
    executionSessionsService.requireAccessibleSession.mockResolvedValue({
      id: 'session-1',
      status: 'COMPLETED',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
    });

    await expect(
      service.append('session-1', dto({ eventType: 'execution.progressed' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns stable cursor pagination', async () => {
    const { service, prisma } = createService();
    prisma.syncEvent.findMany.mockResolvedValue([
      event({ id: 'row-3' }),
      event({ id: 'row-2' }),
      event({ id: 'row-1' }),
    ]);

    const result = await service.list('session-1', { cursor: 'row-4', take: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('row-2');
    expect(prisma.syncEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'row-4' },
        skip: 1,
        take: 3,
      }),
    );
  });
});
