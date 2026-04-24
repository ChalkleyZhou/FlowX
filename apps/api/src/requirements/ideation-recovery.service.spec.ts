import { describe, expect, it, vi } from 'vitest';
import { IdeationRecoveryService } from './ideation-recovery.service';

describe('IdeationRecoveryService stale heartbeat recovery', () => {
  it('marks running sessions as failed when heartbeat is stale', async () => {
    const now = new Date('2026-04-23T10:10:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const prisma = {
      ideationSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'session-1',
            requirementId: 'req-1',
            stage: 'DEMO',
            startedAt: new Date('2026-04-23T10:00:00.000Z'),
            createdAt: new Date('2026-04-23T10:00:00.000Z'),
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      ideationSessionEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      requirement: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    } as any;
    const service = new IdeationRecoveryService(prisma);

    await (service as any).recoverStaleRunningIdeationSessions();

    expect(prisma.ideationSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['session-1'] } },
      }),
    );
    vi.useRealTimers();
  });

  it('keeps running session when there is a fresh heartbeat event', async () => {
    const now = new Date('2026-04-23T10:10:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const prisma = {
      ideationSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'session-2',
            requirementId: 'req-2',
            stage: 'DEMO',
            startedAt: new Date('2026-04-23T10:00:00.000Z'),
            createdAt: new Date('2026-04-23T10:00:00.000Z'),
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      ideationSessionEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            sessionId: 'session-2',
            createdAt: new Date('2026-04-23T10:09:30.000Z'),
          },
        ]),
      },
      requirement: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    } as any;
    const service = new IdeationRecoveryService(prisma);

    await (service as any).recoverStaleRunningIdeationSessions();

    expect(prisma.ideationSession.updateMany).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
