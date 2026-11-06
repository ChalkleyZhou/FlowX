import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationContextService } from '../prisma/organization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { RepositorySyncService } from './repository-sync.service';
import { UpdateRepositoryDto } from './dto/update-repository.dto';
import { UpdateRepositoryBranchDto } from './dto/update-repository-branch.dto';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repositorySyncService: RepositorySyncService,
    private readonly organizationContext: OrganizationContextService,
  ) {}

  create(dto: CreateWorkspaceDto) {
    const organizationId = this.organizationContext.getScope()?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required.');
    }
    return this.prisma.workspace.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description?.trim() || null,
      },
      include: {
        repositories: {
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: {
            projects: true,
            requirements: true,
          },
        },
      },
    });
  }

  async findPage(query: PaginationQuery & { q?: string } = {}) {
    const paging = parsePagination(query);
    const where = query.q?.trim() ? { name: { contains: query.q.trim() } } : {};
    const [items, total, workspaceCount, repositoryCount, projectCount, requirementCount] = await Promise.all([
      this.prisma.workspace.findMany({ where, skip: paging.skip, take: paging.take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { _count: { select: { projects: true, requirements: true, repositories: true } } } }),
      this.prisma.workspace.count({ where }),
      this.prisma.workspace.count(), this.prisma.repository.count(), this.prisma.project.count(), this.prisma.requirement.count(),
    ]);
    return { ...pageResult(items, total, paging), summary: { workspaceCount, repositoryCount, projectCount, requirementCount } };
  }

  findDetail(id: string) {
    return this.prisma.workspace.findUniqueOrThrow({ where: { id }, include: { _count: { select: { projects: true, requirements: true, repositories: true } } } });
  }

  async listRepositories(workspaceId: string, query: PaginationQuery & { q?: string; status?: string } = {}) {
    const paging = parsePagination(query);
    await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const where = { workspaceId, ...(query.status ? { status: query.status } : {}), ...(query.q?.trim() ? { name: { contains: query.q.trim() } } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.repository.findMany({ where, skip: paging.skip, take: paging.take, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.repository.count({ where }),
    ]);
    return pageResult(items, total, paging);
  }

  async getRepository(workspaceId: string, repositoryId: string) {
    const row = await this.prisma.repository.findFirst({ where: { id: repositoryId, workspaceId } });
    if (!row) throw new NotFoundException('Repository not found.');
    return row;
  }

  findAll() {
    return this.prisma.workspace.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        repositories: {
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: {
            projects: true,
            requirements: true,
          },
        },
      },
    });
  }

  async addRepository(workspaceId: string, dto: CreateRepositoryDto) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found.');
    }

    const repositoryUrl = dto.url.trim();

    const repository = await this.prisma.repository.create({
      data: {
        workspaceId,
        name: dto.name,
        url: repositoryUrl,
        defaultBranch: dto.defaultBranch?.trim() || null,
        currentBranch: dto.defaultBranch?.trim() || null,
      },
    });

    this.repositorySyncService.scheduleRepositorySync(repository);
    return repository;
  }

  async resyncRepository(workspaceId: string, repositoryId: string) {
    const repository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
        status: 'ACTIVE',
      },
    });
    if (!repository) {
      throw new NotFoundException('Repository not found.');
    }

    this.repositorySyncService.scheduleRepositorySync(repository);
    return repository;
  }

  async updateRepository(
    workspaceId: string,
    repositoryId: string,
    dto: UpdateRepositoryDto,
  ) {
    const existingRepository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
      },
    });
    if (!existingRepository) {
      throw new NotFoundException('Repository not found.');
    }

    const nextUrl = dto.url.trim();
    const urlChanged = nextUrl !== existingRepository.url;
    const repository = await this.prisma.repository.update({
      where: { id: repositoryId },
      data: {
        name: dto.name.trim(),
        url: nextUrl,
        defaultBranch: dto.defaultBranch?.trim() || null,
        ...(urlChanged
          ? {
              localPath: null,
              syncStatus: 'PENDING',
              syncError: null,
            }
          : {}),
      },
    });

    if (urlChanged) {
      await this.repositorySyncService.removeRepositoryStorage(
        workspaceId,
        repositoryId,
        existingRepository.name,
      );
      this.repositorySyncService.scheduleRepositorySync(repository);
    }

    return repository;
  }

  async updateRepositoryBranch(
    workspaceId: string,
    repositoryId: string,
    dto: UpdateRepositoryBranchDto,
  ) {
    const existingRepository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
      },
    });
    if (!existingRepository) {
      throw new NotFoundException('Repository not found.');
    }

    const repository = await this.prisma.repository.update({
      where: { id: repositoryId },
      data: {
        currentBranch: dto.currentBranch.trim(),
      },
    });

    return this.repositorySyncService.syncRepository(repository);
  }

  async deleteRepository(workspaceId: string, repositoryId: string) {
    const existingRepository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
      },
    });
    if (!existingRepository) {
      throw new NotFoundException('Repository not found.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.briefingEvent.deleteMany({
        where: { repositoryId },
      });
      await tx.briefingSource.deleteMany({
        where: { repositoryId },
      });
      await tx.requirementRepository.deleteMany({
        where: { repositoryId },
      });
      await tx.workflowRepository.updateMany({
        where: { repositoryId },
        data: { repositoryId: null },
      });
      await tx.issue.updateMany({
        where: { repositoryId },
        data: { repositoryId: null },
      });
      await tx.bug.updateMany({
        where: { repositoryId },
        data: { repositoryId: null },
      });
      await tx.repository.delete({
        where: { id: repositoryId },
      });
    });

    await this.repositorySyncService.removeRepositoryStorage(
      existingRepository.workspaceId,
      existingRepository.id,
      existingRepository.name,
    );

    return { success: true };
  }
}
