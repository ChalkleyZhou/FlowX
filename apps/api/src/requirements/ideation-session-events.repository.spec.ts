import { describe, expect, it, vi } from 'vitest';
import {
  IdeationSessionEventsRepository,
  type AppendIdeationSessionEventInput,
} from './ideation-session-events.repository';

describe('IdeationSessionEventsRepository', () => {
  it('appends event with expected payload', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'evt-1' });
    const prisma = {
      ideationSessionEvent: {
        create,
        findMany: vi.fn(),
      },
    } as any;
    const repo = new IdeationSessionEventsRepository(prisma);

    await repo.append({
      sessionId: 'session-1',
      eventType: 'STARTED',
      stage: 'QUEUE',
      message: 'Demo generation started.',
      details: { requirementId: 'req-1' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        sessionId: 'session-1',
        eventType: 'STARTED',
        stage: 'QUEUE',
        message: 'Demo generation started.',
        details: { requirementId: 'req-1' },
      },
    });
  });

  it('lists events ordered by createdAt then id', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'a', createdAt: new Date('2026-04-23T10:00:00.000Z') },
      { id: 'b', createdAt: new Date('2026-04-23T10:00:00.000Z') },
    ]);
    const prisma = {
      ideationSessionEvent: {
        create: vi.fn(),
        findMany,
      },
    } as any;
    const repo = new IdeationSessionEventsRepository(prisma);

    await repo.list('session-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { sessionId: 'session-1' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('accepts only typed eventType and stage values', () => {
    const typedEvent: AppendIdeationSessionEventInput = {
      sessionId: 'session-typed',
      eventType: 'HEARTBEAT',
      stage: 'MODEL_RUNNING',
      message: 'Still running.',
    };
    expect(typedEvent.eventType).toBe('HEARTBEAT');
    expect(typedEvent.stage).toBe('MODEL_RUNNING');
  });
});
