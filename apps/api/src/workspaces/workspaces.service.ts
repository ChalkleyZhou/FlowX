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
