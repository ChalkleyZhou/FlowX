import { Injectable, NotFoundException } from '@nestjs/common';
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
  ) {}

  create(dto: CreateWorkspaceDto) {
    return this.prisma.workspace.create({
      data: {
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

    const repository = await this.prisma.repository.create({
      data: {
        workspaceId,
        name: dto.name,
        url: dto.url,
        defaultBranch: dto.defaultBranch?.trim() || null,
        currentBranch: dto.defaultBranch?.trim() || null,
      },
    });

    try {
      return await this.repositorySyncService.syncRepository(repository);
    } catch (error) {
      await this.prisma.repository.delete({
        where: { id: repository.id },
      });
      await this.repositorySyncService.removeRepositoryStorage(
        repository.workspaceId,
        repository.id,
        repository.name,
      );
      throw error;
    }
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

    return this.prisma.repository.update({
      where: { id: repositoryId },
      data: {
        name: dto.name.trim(),
        defaultBranch: dto.defaultBranch?.trim() || null,
      },
    });
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
