import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionSessionsService } from './execution-sessions.service';

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    workflowRunId: 'workflow-1',
    stageExecutionId: 'stage-1',
    organizationId: 'org-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    deviceId: null,
    status: 'RUNNING',
    executorType: 'LOCAL',
    sourceTool: 'cursor',
    protocolVersion: '1.0',
    traceId: 'trace-1',
    idempotencyKey: 'claim:workflow-1:stage-1',
    claimedByUserId: 'user-1',
    startedAt: new Date('2026-07-22T00:00:00.000Z'),
    lastHeartbeatAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    summary: null,
    metadata: null,
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
    updatedAt: new Date('2026-07-22T00:00:00.000Z'),
    ...overrides,
  };
}

function createService() {
  const prisma = {
    executionSession: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { service: new ExecutionSessionsService(prisma as never), prisma };
}

describe('ExecutionSessionsService', () => {
  it('reuses a matching idempotent create request', async () => {
    const { service, prisma } = createService();
    prisma.executionSession.findUnique.mockResolvedValue(session());

    const result = await service.createOrReuseSession({
      workflowRunId: 'workflow-1',
      stageExecutionId: 'stage-1',
      executorType: 'LOCAL',
      sourceTool: 'cursor',
      idempotencyKey: 'claim:workflow-1:stage-1',
    });

    expect(result.id).toBe('session-1');
    expect(prisma.executionSession.create).not.toHaveBeenCalled();
  });

  it('rejects reusing an idempotency key for another request', async () => {
    const { service, prisma } = createService();
    prisma.executionSession.findUnique.mockResolvedValue(session());

    await expect(
      service.createOrReuseSession({
        workflowRunId: 'workflow-2',
        stageExecutionId: 'stage-1',
        executorType: 'LOCAL',
        sourceTool: 'cursor',
        idempotencyKey: 'claim:workflow-1:stage-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a second active session for the same stage attempt', async () => {
    const { service, prisma } = createService();
    prisma.executionSession.findUnique.mockResolvedValue(null);
    prisma.executionSession.findFirst.mockResolvedValue(session());

    await expect(
      service.createOrReuseSession({
        workflowRunId: 'workflow-1',
        stageExecutionId: 'stage-1',
        executorType: 'LOCAL',
        sourceTool: 'codex',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a claimed session with protocol defaults', async () => {
    const { service, prisma } = createService();
    prisma.executionSession.findUnique.mockResolvedValue(null);
    prisma.executionSession.findFirst.mockResolvedValue(null);
    prisma.executionSession.create.mockImplementation(({ data }: { data: unknown }) => data);

    const result = await service.createOrReuseSession({
      workflowRunId: 'workflow-1',
      stageExecutionId: 'stage-1',
      organizationId: 'org-1',
      status: 'CLAIMED',
      executorType: 'LOCAL',
      sourceTool: 'cursor',
      idempotencyKey: 'claim:workflow-1:stage-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'CLAIMED',
        protocolVersion: '1.0',
        idempotencyKey: 'claim:workflow-1:stage-1',
        traceId: expect.any(String),
      }),
    );
  });

  it('uses compare-and-set when completing a running session', async () => {
    const { service, prisma } = createService();
    prisma.executionSession.findUnique.mockResolvedValue(session());
    prisma.executionSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.executionSession.findUniqueOrThrow.mockResolvedValue(
      session({ status: 'COMPLETED', summary: 'Done' }),
    );

    const result = await service.complete(
      'session-1',
      { summary: 'Done' },
      { organizationId: 'org-1' },
    );

    expect(result.status).toBe('COMPLETED');
    expect(prisma.executionSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1', status: 'RUNNING' },
        data: expect.objectContaining({ status: 'COMPLETED', summary: 'Done' }),
      }),
    );
  });

  it('returns the existing row for an idempotent terminal transition', async () => {
    const { service, prisma } = createService();
    prisma.executionSession.findUnique.mockResolvedValue(session({ status: 'COMPLETED' }));

    const result = await service.complete('session-1', {}, { organizationId: 'org-1' });

    expect(result.status).toBe('COMPLETED');
    expect(prisma.executionSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects illegal transitions out of terminal states', async () => {
    const { service, prisma } = createService();
    prisma.executionSession.findUnique.mockResolvedValue(session({ status: 'COMPLETED' }));

    await expect(service.markRunning('session-1', { organizationId: 'org-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects access from another organization', async () => {
    const { service, prisma } = createService();
    prisma.executionSession.findUnique.mockResolvedValue(session());

    await expect(service.findOne('session-1', { organizationId: 'org-2' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
