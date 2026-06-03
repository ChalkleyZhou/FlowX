import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildDedupeKey } from './briefing-events';
import { CreateBriefingSourceDto } from './dto/create-briefing-source.dto';
import { UpdateBriefingSourceDto } from './dto/update-briefing-source.dto';
import { isGithubPing, normalizeGithubPayload } from './github-events';
import { normalizeGitlabPayload } from './gitlab-events';
import { parseRepositoryRemote } from './repository-remote';
import { verifyGithubWebhookSignature } from './webhook-auth';
import { generateWebhookSecret } from './webhook-secret';

export interface WebhookRequestContext {
  gitlabToken?: string;
  githubSignature?: string;
  githubEvent?: string;
  payload: Record<string, unknown>;
  rawBody?: Buffer;
}

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

  async resolveRepositoryBinding(workspaceId: string, repositoryId: string) {
    const repository = await this.prisma.repository.findFirst({
      where: { id: repositoryId, workspaceId },
    });
    if (!repository) {
      throw new NotFoundException('Repository not found in workspace.');
    }

    const parsed = parseRepositoryRemote(repository.url);
    if (!parsed) {
      throw new BadRequestException(
        'Repository URL is not a supported GitHub or GitLab remote. Use an https or git@ remote.',
      );
    }

    return {
      repositoryId: repository.id,
      repositoryName: repository.name,
      repositoryUrl: repository.url,
      provider: parsed.provider,
      externalPath: parsed.externalPath,
      host: parsed.host,
    };
  }

  async createSource(dto: CreateBriefingSourceDto) {
    const repository = await this.ensureRepositoryInWorkspace(dto.workspaceId, dto.repositoryId);
    const binding = this.resolveBindingFromInput(dto, repository.url);

    return this.prisma.briefingSource.create({
      data: {
        workspaceId: dto.workspaceId,
        repositoryId: dto.repositoryId,
        provider: binding.provider,
        externalPath: binding.externalPath,
        webhookSecret: dto.webhookSecret?.trim() || generateWebhookSecret(),
        isActive: dto.isActive ?? true,
      },
      include: {
        workspace: true,
        repository: true,
      },
    });
  }

  async regenerateWebhookSecret(id: string) {
    await this.ensureSourceExists(id);
    return this.prisma.briefingSource.update({
      where: { id },
      data: { webhookSecret: generateWebhookSecret() },
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
    await this.prisma.briefingEvent.deleteMany({ where: { briefingSourceId: id } });
    await this.prisma.briefingSource.delete({ where: { id } });
    return { success: true };
  }

  async receiveGitlabWebhook(
    sourceId: string,
    token: string | undefined,
    payload: Record<string, unknown>,
  ) {
    return this.receiveWebhook(sourceId, {
      gitlabToken: token,
      payload,
    });
  }

  async receiveWebhook(sourceId: string, context: WebhookRequestContext) {
    const source = await this.prisma.briefingSource.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      throw new NotFoundException('Briefing source not found.');
    }
    if (!source.isActive) {
      throw new BadRequestException('Briefing source is inactive.');
    }

    if (source.provider === 'github') {
      if (isGithubPing(context.githubEvent)) {
        return { duplicate: false, ping: true };
      }
      if (
        !verifyGithubWebhookSignature(
          source.webhookSecret,
          context.rawBody,
          context.githubSignature,
        )
      ) {
        throw new UnauthorizedException('Invalid GitHub webhook signature.');
      }
      const normalized = normalizeGithubPayload(
        context.githubEvent ?? 'unsupported',
        context.payload,
      );
      return this.persistWebhookEvent(source, context.payload, normalized);
    }

    if (!context.gitlabToken || context.gitlabToken !== source.webhookSecret) {
      throw new UnauthorizedException('Invalid GitLab webhook token.');
    }

    const normalized = normalizeGitlabPayload(context.payload);
    return this.persistWebhookEvent(source, context.payload, normalized);
  }

  private resolveBindingFromInput(dto: CreateBriefingSourceDto, repositoryUrl: string) {
    if (dto.provider && dto.externalPath) {
      return {
        provider: dto.provider,
        externalPath: dto.externalPath.trim(),
      };
    }

    const parsed = parseRepositoryRemote(repositoryUrl);
    if (!parsed) {
      throw new BadRequestException(
        'Could not infer provider from repository URL. Register a GitHub or GitLab https/git remote.',
      );
    }

    if (dto.provider && dto.provider !== parsed.provider) {
      throw new BadRequestException('Provider does not match repository URL host.');
    }
    if (dto.externalPath && dto.externalPath.trim() !== parsed.externalPath) {
      throw new BadRequestException('External path does not match repository URL.');
    }

    return parsed;
  }

  private async persistWebhookEvent(
    source: {
      id: string;
      workspaceId: string;
      repositoryId: string;
      provider: string;
      externalPath: string;
      externalId: string | null;
    },
    payload: Record<string, unknown>,
    normalized: ReturnType<typeof normalizeGitlabPayload>,
  ) {
    if (!source.externalId && normalized.externalId) {
      await this.prisma.briefingSource.update({
        where: { id: source.id },
        data: { externalId: normalized.externalId },
      });
    }

    const dedupeKey = buildDedupeKey(normalized);

    try {
      const event = await this.prisma.briefingEvent.create({
        data: {
          briefingSourceId: source.id,
          workspaceId: source.workspaceId,
          repositoryId: source.repositoryId,
          provider: normalized.provider,
          externalPath: normalized.externalPath || source.externalPath,
          externalId: normalized.externalId || null,
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
    return repository;
  }

  private async ensureSourceExists(id: string) {
    const source = await this.prisma.briefingSource.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException('Briefing source not found.');
    }
  }
}
