import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CaseLibrariesService } from './case-libraries.service';

function createService() {
  const prisma = {
    workspace: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    testCaseLibrary: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    testCaseModule: { findFirst: vi.fn(), create: vi.fn() },
    testCaseDefinition: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { service: new CaseLibrariesService(prisma as never), prisma };
}

describe('CaseLibrariesService', () => {
  it('creates a project library only when the project belongs to the workspace', async () => {
    const { service, prisma } = createService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'workspace-1' });
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.createLibrary(
        { workspaceId: 'workspace-1', projectId: 'project-other', name: '回归用例' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists workspace shared cases together with cases from the selected project', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.testCaseDefinition.findMany.mockResolvedValue([]);

    await service.listCases({ workspaceId: 'workspace-1', projectId: 'project-1' });

    expect(prisma.testCaseDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'ACTIVE',
          library: {
            workspaceId: 'workspace-1',
            OR: [{ projectId: null }, { projectId: 'project-1' }],
          },
        },
      }),
    );
  });

  it('does not allow a module from another library to be assigned to a case', async () => {
    const { service, prisma } = createService();
    prisma.testCaseLibrary.findUnique.mockResolvedValue({ id: 'library-1', status: 'ACTIVE' });
    prisma.testCaseModule.findFirst.mockResolvedValue(null);

    await expect(
      service.createCase(
        'library-1',
        { moduleId: 'module-other', title: '登录成功', steps: ['输入账号'], expected: '进入首页' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('paginates and summarizes test cases on the server', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.testCaseDefinition.findMany.mockResolvedValue([{ id: 'case-21' }]);
    prisma.testCaseDefinition.count
      .mockResolvedValueOnce(43)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(31);

    await expect(
      service.listCases({
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        q: '登录',
        priority: 'P0',
        page: 2,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      items: [{ id: 'case-21' }],
      total: 43,
      page: 2,
      pageSize: 20,
      summary: { p0Count: 8, linkedCount: 31 },
    });

    expect(prisma.testCaseDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        where: expect.objectContaining({
          priority: 'P0',
          OR: expect.arrayContaining([
            { title: { contains: '登录' } },
            { externalId: { contains: '登录' } },
          ]),
        }),
      }),
    );
  });

  it('archives a test case instead of deleting its historical references', async () => {
    const { service, prisma } = createService();
    prisma.testCaseDefinition.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.deleteCase('case-1')).resolves.toEqual({ success: true });
    expect(prisma.testCaseDefinition.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-1', status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });
  });

  it('rejects deleting a missing or archived test case', async () => {
    const { service, prisma } = createService();
    prisma.testCaseDefinition.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.deleteCase('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
