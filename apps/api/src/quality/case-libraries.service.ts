import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateCaseLibraryDto,
  CreateTestCaseDefinitionDto,
  CreateTestCaseModuleDto,
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

  async listCases(filters: {
    workspaceId: string;
    projectId?: string;
    libraryId?: string;
    moduleId?: string;
  }) {
    if (filters.projectId) {
      await this.requireProjectInWorkspace(filters.projectId, filters.workspaceId);
    }
    return this.prisma.testCaseDefinition.findMany({
      where: {
        status: 'ACTIVE',
        library: {
          workspaceId: filters.workspaceId,
          ...(filters.projectId
            ? { OR: [{ projectId: null }, { projectId: filters.projectId }] }
            : { projectId: null }),
        },
        ...(filters.libraryId ? { libraryId: filters.libraryId } : {}),
        ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
      },
      include: { library: true, module: true, coverageLinks: true },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    });
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
