import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCodeReviewSourceDto } from './dto/create-code-review-source.dto';
import { UpdateCodeReviewSourceDto } from './dto/update-code-review-source.dto';

@Injectable()
export class CodeReviewSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  listSources(workspaceId?: string) {
    return this.prisma.codeReviewSource.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        workspace: true,
        repository: true,
      },
    });
  }

  /**
   * Creation is idempotent: since a repository can only have one CodeReviewSource
   * (`@@unique([repositoryId])`), re-adding a repository reactivates its existing row.
   */
  async createSource(dto: CreateCodeReviewSourceDto) {
    await this.ensureRepositoryInWorkspace(dto.workspaceId, dto.repositoryId);
    const isActive = dto.isActive ?? true;

    return this.prisma.codeReviewSource.upsert({
      where: { repositoryId: dto.repositoryId },
      create: {
        workspaceId: dto.workspaceId,
        repositoryId: dto.repositoryId,
        isActive,
      },
      update: { isActive },
      include: {
        workspace: true,
        repository: true,
      },
    });
  }

  async updateSource(id: string, dto: UpdateCodeReviewSourceDto) {
    await this.ensureSourceExists(id);

    return this.prisma.codeReviewSource.update({
      where: { id },
      data: {
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
      include: {
        workspace: true,
        repository: true,
      },
    });
  }

  async deleteSource(id: string) {
    await this.ensureSourceExists(id);
    await this.prisma.codeReviewSource.delete({ where: { id } });
    return { success: true };
  }

  private async ensureRepositoryInWorkspace(workspaceId: string, repositoryId: string) {
    const repository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
      },
    });
    if (!repository) {
      throw new NotFoundException('Repository not found in workspace.');
    }
    return repository;
  }

  private async ensureSourceExists(id: string) {
    const source = await this.prisma.codeReviewSource.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException('Code review source not found.');
    }
  }
}
