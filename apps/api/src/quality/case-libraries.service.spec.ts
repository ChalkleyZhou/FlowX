import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CaseLibrariesService } from './case-libraries.service';

function createService() {
  const prisma = {
    workspace: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    testCaseLibrary: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    testCaseModule: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    testCaseDefinition: {
      create: vi.fn(),
      createMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
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

  it('updates an active test case and increments its definition version', async () => {
    const { service, prisma } = createService();
    prisma.testCaseDefinition.findFirst
      .mockResolvedValueOnce({
        id: 'case-1',
        libraryId: 'library-1',
        moduleId: null,
        externalId: 'LOGIN-001',
        status: 'ACTIVE',
      })
      .mockResolvedValueOnce(null);
    prisma.testCaseModule.findFirst.mockResolvedValue({ id: 'module-1', libraryId: 'library-1' });
    prisma.testCaseDefinition.update.mockResolvedValue({ id: 'case-1', version: 4 });

    await expect(service.updateCase('case-1', {
      libraryId: 'library-1',
      moduleId: 'module-1',
      externalId: 'LOGIN-002',
      title: ' 更新后的登录用例 ',
      priority: 'P1',
      precondition: '',
      steps: [' 输入账号 ', ' ', '点击登录'],
      expected: ' 进入首页 ',
      tags: [' 回归 ', ' '],
    })).resolves.toEqual({ id: 'case-1', version: 4 });

    expect(prisma.testCaseDefinition.update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: expect.objectContaining({
        libraryId: 'library-1',
        moduleId: 'module-1',
        externalId: 'LOGIN-002',
        title: '更新后的登录用例',
        priority: 'P1',
        precondition: null,
        steps: ['输入账号', '点击登录'],
        expected: '进入首页',
        tags: ['回归'],
        version: { increment: 1 },
      }),
      include: { library: true, module: true, coverageLinks: true },
    });
  });

  it('rejects updating a missing or archived test case', async () => {
    const { service, prisma } = createService();
    prisma.testCaseDefinition.findFirst.mockResolvedValue(null);

    await expect(service.updateCase('missing', { title: '更新' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.testCaseDefinition.update).not.toHaveBeenCalled();
  });

  it('does not increment the version for an empty update', async () => {
    const { service, prisma } = createService();

    await expect(service.updateCase('case-1', {}))
      .rejects.toThrow('At least one test case field is required.');
    expect(prisma.testCaseDefinition.findFirst).not.toHaveBeenCalled();
    expect(prisma.testCaseDefinition.update).not.toHaveBeenCalled();
  });

  it('imports validated test cases in one batch and resolves modules by name', async () => {
    const { service, prisma } = createService();
    prisma.testCaseLibrary.findUnique.mockResolvedValue({ id: 'library-1', status: 'ACTIVE' });
    prisma.testCaseModule.findMany.mockResolvedValue([{ id: 'module-1', name: '登录' }]);
    prisma.testCaseDefinition.findMany.mockResolvedValue([]);
    prisma.testCaseDefinition.createMany.mockResolvedValue({ count: 2 });

    await expect(
      service.importCases(
        'library-1',
        {
          cases: [
            {
              externalId: 'LOGIN-001',
              title: '账号密码登录成功',
              priority: 'P0',
              moduleName: '登录',
              steps: ['输入账号', '点击登录'],
              expected: '进入首页',
              tags: ['冒烟'],
            },
            { title: '登录失败', steps: ['输入错误密码'], expected: '提示密码错误' },
          ],
        },
        'user-1',
      ),
    ).resolves.toEqual({ imported: 2 });

    expect(prisma.testCaseDefinition.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          libraryId: 'library-1',
          moduleId: 'module-1',
          externalId: 'LOGIN-001',
          priority: 'P0',
          createdByUserId: 'user-1',
        }),
        expect.objectContaining({ moduleId: null, priority: 'P2' }),
      ],
    });
  });

  it('rejects the whole import when a referenced module is missing', async () => {
    const { service, prisma } = createService();
    prisma.testCaseLibrary.findUnique.mockResolvedValue({ id: 'library-1', status: 'ACTIVE' });
    prisma.testCaseModule.findMany.mockResolvedValue([]);

    await expect(
      service.importCases('library-1', {
        cases: [{ title: '登录成功', moduleName: '不存在模块', steps: ['登录'], expected: '成功' }],
      }),
    ).rejects.toThrow('第 2 行：模块“不存在模块”不存在于目标用例库。');
    expect(prisma.testCaseDefinition.createMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate external IDs in the same import', async () => {
    const { service, prisma } = createService();
    prisma.testCaseLibrary.findUnique.mockResolvedValue({ id: 'library-1', status: 'ACTIVE' });

    await expect(
      service.importCases('library-1', {
        cases: [
          { externalId: 'CASE-1', title: '用例 1', steps: ['步骤'], expected: '成功' },
          { externalId: 'CASE-1', title: '用例 2', steps: ['步骤'], expected: '成功' },
        ],
      }),
    ).rejects.toThrow('第 3 行：用例编号“CASE-1”与第 2 行重复。');
    expect(prisma.testCaseDefinition.createMany).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only required fields before writing', async () => {
    const { service, prisma } = createService();
    prisma.testCaseLibrary.findUnique.mockResolvedValue({ id: 'library-1', status: 'ACTIVE' });

    await expect(
      service.importCases('library-1', {
        cases: [{ title: '   ', steps: ['   '], expected: '   ' }],
      }),
    ).rejects.toThrow('第 2 行：标题不能为空。');
    expect(prisma.testCaseDefinition.createMany).not.toHaveBeenCalled();
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
