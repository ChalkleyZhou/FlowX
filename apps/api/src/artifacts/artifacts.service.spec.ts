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

  it('creates a pending managed upload and verifies uploaded content', async () => {
    const { service, prisma, executionSessions, storage } = createService();
    const expectedSha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    executionSessions.requireAccessibleSession.mockResolvedValue(runningSession);
    prisma.artifact.create.mockImplementation(({ data }: { data: unknown }) => ({ id: 'artifact-1', ...data as object }));
    prisma.artifact.findUnique.mockResolvedValue({
      id: 'artifact-1',
      executionSessionId: 'session-1',
      storageProvider: 'local',
      storageKey: 'managed/session-1/artifact-1/execution.log',
      status: 'PENDING',
      sha256: expectedSha256,
      byteSize: 4,
      executionSession: { organizationId: 'org-1' },
    });
    storage.write.mockResolvedValue({
      storageKey: 'managed/session-1/artifact-1/execution.log',
      byteSize: 4,
      sha256: expectedSha256,
    });
    prisma.artifact.update.mockImplementation(({ data }: { data: unknown }) => ({ id: 'artifact-1', ...data as object }));

    const pending = await service.createManagedUpload('session-1', {
      artifactType: 'LOG',
      name: 'execution.log',
      mimeType: 'text/plain',
      byteSize: 4,
      sha256: expectedSha256,
    }, { organizationId: 'org-1' });
    const completed = await service.writeManagedContent('artifact-1', Buffer.from('test'), {
      organizationId: 'org-1',
    });

    expect(pending).toEqual(expect.objectContaining({ artifact: expect.objectContaining({ status: 'PENDING' }) }));
    expect(completed).toEqual(expect.objectContaining({ status: 'AVAILABLE' }));
  });

  it('accepts an identical content retry after the artifact became available', async () => {
    const { service, prisma, storage } = createService();
    const expectedSha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const artifact = {
      id: 'artifact-1',
      executionSessionId: 'session-1',
      storageProvider: 'local',
      storageKey: 'managed/session-1/artifact-1/execution.log',
      status: 'AVAILABLE',
      sha256: expectedSha256,
      byteSize: 4,
      executionSession: { organizationId: 'org-1' },
    };
    prisma.artifact.findUnique.mockResolvedValue(artifact);

    await expect(
      service.writeManagedContent('artifact-1', Buffer.from('test'), { organizationId: 'org-1' }),
    ).resolves.toBe(artifact);
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('rejects uploaded content when its digest does not match the declaration', async () => {
    const { service, prisma, storage } = createService();
    prisma.artifact.findUnique.mockResolvedValue({
      id: 'artifact-1',
      executionSessionId: 'session-1',
      storageProvider: 'local',
      storageKey: 'managed/session-1/artifact-1/execution.log',
      status: 'PENDING',
      sha256: 'a'.repeat(64),
      byteSize: 4,
      executionSession: { organizationId: 'org-1' },
    });
    storage.write.mockResolvedValue({
      storageKey: 'managed/session-1/artifact-1/execution.log',
      byteSize: 4,
      sha256: 'b'.repeat(64),
    });

    await expect(
      service.writeManagedContent('artifact-1', Buffer.from('test'), { organizationId: 'org-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.write).not.toHaveBeenCalled();
  });
});
