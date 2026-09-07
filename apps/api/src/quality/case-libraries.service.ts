import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateCaseLibraryDto,
  CreateTestCaseDefinitionDto,
  CreateTestCaseModuleDto,
  ImportTestCasesDto,
  UpdateTestCaseDefinitionDto,
} from './dto/case-library.dto';

@Injectable()
export class CaseLibrariesService {
  constructor(private readonly prisma: PrismaService) {}

  async createLibrary(dto: CreateCaseLibraryDto, userId?: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: dto.workspaceId } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found.');
    }
    if (dto.projectId) {
      await this.requireProjectInWorkspace(dto.projectId, dto.workspaceId);
    }
    return this.prisma.testCaseLibrary.create({
      data: {
        workspaceId: dto.workspaceId,
        projectId: dto.projectId ?? null,
        scope: dto.projectId ? 'PROJECT' : 'WORKSPACE',
        name: dto.name.trim(),
        createdByUserId: userId ?? null,
      },
    });
  }

  async listLibraries(filters: { workspaceId: string; projectId?: string }) {
    if (filters.projectId) {
      await this.requireProjectInWorkspace(filters.projectId, filters.workspaceId);
    }
    return this.prisma.testCaseLibrary.findMany({
      where: {
        workspaceId: filters.workspaceId,
        status: 'ACTIVE',
        ...(filters.projectId
          ? { OR: [{ projectId: null }, { projectId: filters.projectId }] }
          : { projectId: null }),
      },
      include: { _count: { select: { definitions: true, modules: true } } },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
    });
  }

  async createModule(libraryId: string, dto: CreateTestCaseModuleDto) {
    await this.requireLibrary(libraryId);
    if (dto.parentId) {
      const parent = await this.prisma.testCaseModule.findFirst({
        where: { id: dto.parentId, libraryId },
      });
      if (!parent) {
        throw new BadRequestException('Parent module does not belong to the selected library.');
      }
    }
    return this.prisma.testCaseModule.create({
      data: {
        libraryId,
        parentId: dto.parentId ?? null,
        name: dto.name.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async listModules(libraryId: string) {
    await this.requireLibrary(libraryId);
    return this.prisma.testCaseModule.findMany({
      where: { libraryId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCase(libraryId: string, dto: CreateTestCaseDefinitionDto, userId?: string) {
    await this.requireLibrary(libraryId);
    if (dto.moduleId) {
      const module = await this.prisma.testCaseModule.findFirst({
        where: { id: dto.moduleId, libraryId },
      });
      if (!module) {
        throw new BadRequestException('Module does not belong to the selected library.');
      }
    }
    return this.prisma.testCaseDefinition.create({
      data: {
        libraryId,
        moduleId: dto.moduleId ?? null,
        externalId: dto.externalId?.trim() || null,
        title: dto.title.trim(),
        priority: dto.priority ?? 'P2',
        precondition: dto.precondition?.trim() || null,
        steps: dto.steps as Prisma.InputJsonValue,
        expected: dto.expected.trim(),
        tags: dto.tags as Prisma.InputJsonValue | undefined,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        createdByUserId: userId ?? null,
        coverageLinks: dto.coverageLinks?.length
          ? {
              create: dto.coverageLinks.map((link) => ({
                targetType: link.targetType,
                targetKey: link.targetKey.trim(),
                source: link.source ?? 'MANUAL',
                confidence: link.confidence,
                evidence: link.evidence as Prisma.InputJsonValue | undefined,
              })),
            }
          : undefined,
      },
      include: { module: true, coverageLinks: true },
    });
  }

  async importCases(libraryId: string, dto: ImportTestCasesDto, userId?: string) {
    await this.requireLibrary(libraryId);

    const cases = dto.cases.map((item, index) => {
      const title = item.title.trim();
      const steps = item.steps.map((step) => step.trim()).filter(Boolean);
      const expected = item.expected.trim();
      if (!title) throw new BadRequestException(`第 ${index + 2} 行：标题不能为空。`);
      if (!steps.length) throw new BadRequestException(`第 ${index + 2} 行：至少填写一个执行步骤。`);
      if (!expected) throw new BadRequestException(`第 ${index + 2} 行：预期结果不能为空。`);
      return {
        ...item,
        externalId: item.externalId?.trim() || undefined,
        title,
        moduleName: item.moduleName?.trim() || undefined,
        precondition: item.precondition?.trim() || undefined,
        steps,
        expected,
        tags: item.tags?.map((tag) => tag.trim()).filter(Boolean),
      };
    });

    const moduleNames = [...new Set(cases.map((item) => item.moduleName).filter(Boolean))] as string[];
    const modules = moduleNames.length
      ? await this.prisma.testCaseModule.findMany({
          where: { libraryId, name: { in: moduleNames } },
          select: { id: true, name: true },
        })
      : [];
    const modulesByName = new Map<string, string[]>();
    for (const module of modules) {
      modulesByName.set(module.name, [...(modulesByName.get(module.name) ?? []), module.id]);
    }

    for (const [index, item] of cases.entries()) {
      const moduleName = item.moduleName;
      if (!moduleName) continue;
      const matchingModules = modulesByName.get(moduleName) ?? [];
      if (matchingModules.length === 0) {
        throw new BadRequestException(`第 ${index + 2} 行：模块“${moduleName}”不存在于目标用例库。`);
      }
      if (matchingModules.length > 1) {
        throw new BadRequestException(`第 ${index + 2} 行：模块“${moduleName}”存在重名，请先调整模块名称。`);
      }
    }

    const externalIdRows = new Map<string, number>();
    for (const [index, item] of cases.entries()) {
      const externalId = item.externalId;
      if (!externalId) continue;
      const previousRow = externalIdRows.get(externalId);
      if (previousRow) {
        throw new BadRequestException(`第 ${index + 2} 行：用例编号“${externalId}”与第 ${previousRow} 行重复。`);
      }
      externalIdRows.set(externalId, index + 2);
    }

    if (externalIdRows.size) {
      const existingCases = await this.prisma.testCaseDefinition.findMany({
        where: {
          libraryId,
          status: 'ACTIVE',
          externalId: { in: [...externalIdRows.keys()] },
        },
        select: { externalId: true },
      });
      const existingId = existingCases.find((item) => item.externalId)?.externalId;
      if (existingId) {
        throw new BadRequestException(`用例编号“${existingId}”已存在于目标用例库。`);
      }
    }

    const result = await this.prisma.testCaseDefinition.createMany({
      data: cases.map((item) => {
        const moduleName = item.moduleName;
        return {
          libraryId,
          moduleId: moduleName ? modulesByName.get(moduleName)?.[0] : null,
          externalId: item.externalId ?? null,
          title: item.title,
          priority: item.priority ?? 'P2',
          precondition: item.precondition ?? null,
          steps: item.steps as Prisma.InputJsonValue,
          expected: item.expected,
          tags: item.tags?.length
            ? (item.tags as Prisma.InputJsonValue)
            : undefined,
          createdByUserId: userId ?? null,
        };
      }),
    });

    return { imported: result.count };
  }

  async updateCase(id: string, dto: UpdateTestCaseDefinitionDto) {
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('At least one test case field is required.');
    }
    const current = await this.prisma.testCaseDefinition.findFirst({
      where: { id, status: 'ACTIVE' },
    });
    if (!current) throw new NotFoundException('Test case not found.');

    const targetLibraryId = dto.libraryId ?? current.libraryId;
    if (targetLibraryId !== current.libraryId) await this.requireLibrary(targetLibraryId);

    let moduleId: string | null | undefined;
    if (dto.moduleId !== undefined) {
      moduleId = dto.moduleId;
      if (moduleId) {
        const module = await this.prisma.testCaseModule.findFirst({
          where: { id: moduleId, libraryId: targetLibraryId },
        });
        if (!module) {
          throw new BadRequestException('Module does not belong to the selected library.');
        }
      }
    } else if (targetLibraryId !== current.libraryId) {
      moduleId = null;
    }

    const externalId = dto.externalId !== undefined
      ? dto.externalId?.trim() || null
      : current.externalId;
    if (externalId) {
      const duplicate = await this.prisma.testCaseDefinition.findFirst({
        where: {
          id: { not: id },
          libraryId: targetLibraryId,
          externalId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException(`Test case external ID “${externalId}” already exists.`);
      }
    }

    const title = dto.title?.trim();
    const steps = dto.steps?.map((step) => step.trim()).filter(Boolean);
    const expected = dto.expected?.trim();
    if (dto.title !== undefined && !title) throw new BadRequestException('Test case title is required.');
    if (dto.steps !== undefined && !steps?.length) throw new BadRequestException('At least one test step is required.');
    if (dto.expected !== undefined && !expected) throw new BadRequestException('Expected result is required.');

    return this.prisma.testCaseDefinition.update({
      where: { id },
      data: {
        ...(dto.libraryId !== undefined ? { libraryId: targetLibraryId } : {}),
        ...(moduleId !== undefined ? { moduleId } : {}),
        ...(dto.externalId !== undefined ? { externalId } : {}),
        ...(dto.title !== undefined ? { title } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.precondition !== undefined ? { precondition: dto.precondition?.trim() || null } : {}),
        ...(dto.steps !== undefined ? { steps: steps as Prisma.InputJsonValue } : {}),
        ...(dto.expected !== undefined ? { expected } : {}),
        ...(dto.tags !== undefined
          ? { tags: dto.tags.map((tag) => tag.trim()).filter(Boolean) as Prisma.InputJsonValue }
          : {}),
        version: { increment: 1 },
      },
      include: { library: true, module: true, coverageLinks: true },
    });
  }

  async listCases(filters: {
    workspaceId: string;
    projectId?: string;
    libraryId?: string;
    moduleId?: string;
    q?: string;
    priority?: string;
    page?: number;
    pageSize?: number;
  }) {
    if (filters.projectId) {
      await this.requireProjectInWorkspace(filters.projectId, filters.workspaceId);
    }
    const keyword = filters.q?.trim();
    const scopeWhere: Prisma.TestCaseDefinitionWhereInput = {
      status: 'ACTIVE',
      library: {
        workspaceId: filters.workspaceId,
        ...(filters.projectId
          ? { OR: [{ projectId: null }, { projectId: filters.projectId }] }
          : { projectId: null }),
      },
      ...(filters.libraryId ? { libraryId: filters.libraryId } : {}),
      ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword } },
              { externalId: { contains: keyword } },
              { expected: { contains: keyword } },
              { library: { name: { contains: keyword } } },
              { module: { name: { contains: keyword } } },
            ],
          }
        : {}),
    };
    const where: Prisma.TestCaseDefinitionWhereInput = {
      ...scopeWhere,
      ...(filters.priority ? { priority: filters.priority } : {}),
    };
    const query = {
      where,
      include: { library: true, module: true, coverageLinks: true },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    } satisfies Prisma.TestCaseDefinitionFindManyArgs;

    if (filters.page === undefined && filters.pageSize === undefined) {
      return this.prisma.testCaseDefinition.findMany(query);
    }

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const [items, total, p0Count, linkedCount] = await Promise.all([
      this.prisma.testCaseDefinition.findMany({
        ...query,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.testCaseDefinition.count({ where }),
      this.prisma.testCaseDefinition.count({ where: { ...scopeWhere, priority: 'P0' } }),
      this.prisma.testCaseDefinition.count({
        where: { ...scopeWhere, coverageLinks: { some: {} } },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      summary: { p0Count, linkedCount },
    };
  }

  async deleteCase(id: string) {
    const result = await this.prisma.testCaseDefinition.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });
    if (result.count === 0) {
      throw new NotFoundException('Test case not found.');
    }
    return { success: true };
  }

  private async requireLibrary(id: string) {
    const library = await this.prisma.testCaseLibrary.findUnique({ where: { id } });
    if (!library || library.status !== 'ACTIVE') {
      throw new NotFoundException('Test case library not found.');
    }
    return library;
  }

  private async requireProjectInWorkspace(projectId: string, workspaceId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, status: 'ACTIVE' },
    });
    if (!project) {
      throw new BadRequestException('Project does not belong to the selected workspace.');
    }
    return project;
  }
}
