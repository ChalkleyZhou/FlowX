import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CaseLibrariesService } from './case-libraries.service';

function createService() {
  const prisma = {
    workspace: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    testCaseLibrary: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    testCaseModule: { findFirst: vi.fn(), create: vi.fn() },
    testCaseDefinition: { create: vi.fn(), findMany: vi.fn() },
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
});
