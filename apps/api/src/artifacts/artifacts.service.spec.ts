import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactsService } from './artifacts.service';

function createService() {
  const prisma = {
    artifact: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workflowRun: {
      findUnique: vi.fn(),
    },
  };
  const executionSessions = {
    requireAccessibleSession: vi.fn(),
  };
  const storage = {
    provider: 'local',
    resolvePath: vi.fn().mockReturnValue('/safe/report.html'),
    write: vi.fn(),
    read: vi.fn(),
    stat: vi.fn(),
  };
  return {
    service: new ArtifactsService(prisma as never, executionSessions as never, storage as never),
    prisma,
    executionSessions,
    storage,
  };
}

const runningSession = {
  id: 'session-1',
  workflowRunId: 'workflow-1',
  organizationId: 'org-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
};

describe('ArtifactsService', () => {
  it('returns the existing artifact for a matching sha256 registration', async () => {
    const { service, prisma, executionSessions } = createService();
    executionSessions.requireAccessibleSession.mockResolvedValue(runningSession);
    prisma.artifact.findFirst.mockResolvedValue({
      id: 'artifact-1',
      storageProvider: 'local',
      storageKey: 'managed/session-1/report.html',
      externalUrl: null,
    });

    const result = await service.registerForSession(
      'session-1',
      {
        artifactType: 'EXECUTION_REPORT',
        name: '执行报告',
        storageProvider: 'local',
        storageKey: 'managed/session-1/report.html',
        sha256: 'a'.repeat(64),
      },
      { organizationId: 'org-1', userId: 'user-1' },
    );

    expect(result.id).toBe('artifact-1');
    expect(prisma.artifact.create).not.toHaveBeenCalled();
  });

  it('rejects invalid external URLs', async () => {
    const { service, executionSessions } = createService();
    executionSessions.requireAccessibleSession.mockResolvedValue(runningSession);

    await expect(
      service.registerForSession(
        'session-1',
        {
          artifactType: 'GIT_REFERENCE',
          name: 'Commit',
          storageProvider: 'external',
          externalUrl: 'file:///etc/passwd',
        },
        { organizationId: 'org-1' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reading an artifact owned by another organization', async () => {
    const { service, prisma } = createService();
    prisma.artifact.findUnique.mockResolvedValue({
      id: 'artifact-1',
      executionSession: { organizationId: 'org-2' },
    });

    await expect(service.findOne('artifact-1', { organizationId: 'org-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('validates local storage keys through the provider before registration', async () => {
    const { service, prisma, executionSessions, storage } = createService();
    executionSessions.requireAccessibleSession.mockResolvedValue(runningSession);
    prisma.artifact.findFirst.mockResolvedValue(null);
    prisma.artifact.create.mockImplementation(({ data }: { data: unknown }) => data);

    await service.registerForSession('session-1', {
      artifactType: 'LOG',
      name: '执行日志',
      storageProvider: 'local',
      storageKey: 'managed/session-1/execution.log',
    });

    expect(storage.resolvePath).toHaveBeenCalledWith('managed/session-1/execution.log');
  });
});
