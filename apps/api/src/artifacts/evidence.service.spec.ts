import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceService } from './evidence.service';

function createService() {
  const prisma = {
    artifact: { findUnique: vi.fn() },
    evidence: { create: vi.fn(), findMany: vi.fn() },
  };
  const executionSessions = { requireAccessibleSession: vi.fn() };
  return {
    service: new EvidenceService(prisma as never, executionSessions as never),
    prisma,
    executionSessions,
  };
}

describe('EvidenceService', () => {
  it('allows structured evidence without an artifact', async () => {
    const { service, prisma, executionSessions } = createService();
    executionSessions.requireAccessibleSession.mockResolvedValue({
      id: 'session-1',
      workflowRunId: 'workflow-1',
      workspaceId: 'workspace-1',
    });
    prisma.evidence.create.mockImplementation(({ data }: { data: unknown }) => data);

    const result = await service.register('session-1', {
      evidenceType: 'TEST_RESULT',
      sourceTool: 'test-runner',
      title: 'API tests',
      summary: '408 passed',
      metadata: { passed: 408 },
    });

    expect(result).toEqual(expect.objectContaining({ evidenceType: 'TEST_RESULT', artifactId: null }));
  });

  it('rejects an artifact from another workflow', async () => {
    const { service, prisma, executionSessions } = createService();
    executionSessions.requireAccessibleSession.mockResolvedValue({
      id: 'session-1',
      workflowRunId: 'workflow-1',
      workspaceId: 'workspace-1',
    });
    prisma.artifact.findUnique.mockResolvedValue({
      id: 'artifact-2',
      workflowRunId: 'workflow-2',
      executionSessionId: null,
      workspaceId: 'workspace-1',
      status: 'AVAILABLE',
    });

    await expect(
      service.register('session-1', {
        evidenceType: 'GIT_COMMIT',
        sourceTool: 'cursor',
        title: 'Commit abc',
        artifactId: 'artifact-2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
