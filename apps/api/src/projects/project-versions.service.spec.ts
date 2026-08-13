import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectVersionsService } from './project-versions.service';

describe('ProjectVersionsService', () => {
  const projectId = 'proj-1';
  const version = {
    id: 'ver-1',
    projectId,
    name: '2.6.0',
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    updatedAt: new Date('2026-08-13T00:00:00.000Z'),
  };
  let prisma: {
    project: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    projectVersion: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    requirement: { count: ReturnType<typeof vi.fn> };
  };
  let service: ProjectVersionsService;

  beforeEach(() => {
    prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ id: projectId, currentVersionId: null }),
        update: vi.fn(),
      },
      projectVersion: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      requirement: { count: vi.fn() },
    };
    service = new ProjectVersionsService(prisma as never);
  });

  it('rejects blank names', async () => {
    await expect(service.create(projectId, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate names as 409', async () => {
    prisma.projectVersion.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.2' }),
    );
    await expect(service.create(projectId, { name: '2.6.0' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses delete when requirements still reference the version', async () => {
    prisma.projectVersion.findFirst.mockResolvedValue(version);
    prisma.requirement.count.mockResolvedValue(1);
    await expect(service.remove(projectId, version.id)).rejects.toThrow(/still assigned to requirements/);
  });

  it('refuses delete when the version is current', async () => {
    prisma.project.findUnique.mockResolvedValue({ id: projectId, currentVersionId: version.id });
    prisma.projectVersion.findFirst.mockResolvedValue(version);
    prisma.requirement.count.mockResolvedValue(0);
    await expect(service.remove(projectId, version.id)).rejects.toThrow(/current version/);
  });

  it('rejects currentVersionId from another project', async () => {
    prisma.projectVersion.findFirst.mockResolvedValue(null);
    await expect(service.setCurrentVersion(projectId, 'ver-other')).rejects.toBeInstanceOf(BadRequestException);
  });
});
