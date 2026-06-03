import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildDedupeKey, normalizeGitlabPayload } from './gitlab-events';
import { CreateBriefingSourceDto } from './dto/create-briefing-source.dto';
import { UpdateBriefingSourceDto } from './dto/update-briefing-source.dto';

@Injectable()
export class BriefingSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  listSources(workspaceId?: string) {
    return this.prisma.briefingSource.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        workspace: true,
        repository: true,
      },
    });
  }

  async createSource(dto: CreateBriefingSourceDto) {
    await this.ensureRepositoryInWorkspace(dto.workspaceId, dto.repositoryId);

    return this.prisma.briefingSource.create({
      data: {
        workspaceId: dto.workspaceId,
        repositoryId: dto.repositoryId,
        provider: 'gitlab',
        gitlabProjectId: dto.gitlabProjectId,
        pathWithNamespace: dto.pathWithNamespace.trim(),
        webhookSecret: dto.webhookSecret.trim(),
        isActive: dto.isActive ?? true,
      },
      include: {
        workspace: true,
        repository: true,
      },
    });
  }

  async updateSource(id: string, dto: UpdateBriefingSourceDto) {
    await this.ensureSourceExists(id);

    return this.prisma.briefingSource.update({
      where: { id },
      data: {
        ...(dto.gitlabProjectId === undefined ? {} : { gitlabProjectId: dto.gitlabProjectId }),
        ...(dto.pathWithNamespace === undefined
          ? {}
          : { pathWithNamespace: dto.pathWithNamespace.trim() }),
        ...(dto.webhookSecret === undefined ? {} : { webhookSecret: dto.webhookSecret.trim() }),
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
    await this.prisma.gitlabEvent.deleteMany({ where: { briefingSourceId: id } });
    await this.prisma.briefingSource.delete({ where: { id } });
    return { success: true };
  }

  async receiveGitlabWebhook(
    sourceId: string,
    token: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const source = await this.prisma.briefingSource.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      throw new NotFoundException('Briefing source not found.');
    }
    if (!source.isActive) {
      throw new BadRequestException('Briefing source is inactive.');
    }
    if (!token || token !== source.webhookSecret) {
      throw new UnauthorizedException('Invalid GitLab webhook token.');
    }

    const normalized = normalizeGitlabPayload(payload);
    const dedupeKey = buildDedupeKey(normalized);

    try {
      const event = await this.prisma.gitlabEvent.create({
        data: {
          briefingSourceId: source.id,
          workspaceId: source.workspaceId,
          repositoryId: source.repositoryId,
          gitlabProjectId: normalized.gitlabProjectId,
          eventType: normalized.eventType,
          objectKind: normalized.objectKind,
          actorName: normalized.actorName ?? null,
          actorUsername: normalized.actorUsername ?? null,
          occurredAt: new Date(normalized.occurredAt),
          dedupeKey,
          rawPayload: payload as Prisma.InputJsonValue,
          normalizedPayload: normalized as unknown as Prisma.InputJsonValue,
        },
      });

      return { duplicate: false, id: event.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { duplicate: true };
      }
      throw error;
    }
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
  }

  private async ensureSourceExists(id: string) {
    const source = await this.prisma.briefingSource.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException('Briefing source not found.');
    }
  }
}

