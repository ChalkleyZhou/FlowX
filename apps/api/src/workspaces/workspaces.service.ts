import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateRepositoryBranchDto } from './dto/update-repository-branch.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.repository.create({
      data: {
        workspaceId,
        name: dto.name,
        url: dto.url,
        defaultBranch: dto.defaultBranch?.trim() || null,
        currentBranch: dto.defaultBranch?.trim() || null,
      },
    });
  }

  async updateRepositoryBranch(
    workspaceId: string,
    repositoryId: string,
    dto: UpdateRepositoryBranchDto,
  ) {
    const repository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
      },
    });
    if (!repository) {
      throw new NotFoundException('Repository not found.');
    }

    return this.prisma.repository.update({
      where: { id: repositoryId },
      data: {
        currentBranch: dto.currentBranch.trim(),
      },
    });
  }
}
