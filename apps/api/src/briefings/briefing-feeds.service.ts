import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BRIEFING_TIMEZONE,
  DEFAULT_BRIEFING_CUTOFF_HOUR,
} from './briefing-time-window';
import { CreateBriefingFeedDto, UpdateBriefingFeedDto } from './dto/briefing-feed.dto';

const feedInclude = {
  repositories: { orderBy: { createdAt: 'asc' as const } },
  deliveryTargets: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.BriefingFeedInclude;

type BriefingFeedRecord = Prisma.BriefingFeedGetPayload<{ include: typeof feedInclude }>;

@Injectable()
export class BriefingFeedsService {
  constructor(private readonly prisma: PrismaService) {}

  async listFeeds(projectId: string) {
    await this.ensureProject(projectId);
    const feeds = await this.prisma.briefingFeed.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: feedInclude,
    });
    return feeds.map((feed) => this.serialize(feed));
  }

  async getFeed(id: string) {
    return this.serialize(await this.requireFeed(id));
  }

  async createFeed(projectId: string, dto: CreateBriefingFeedDto) {
    const project = await this.ensureProject(projectId);
    const name = this.requireName(dto.name);
    await this.assertNameAvailable(projectId, name);
    const repositoryIds = await this.resolveRepositoryIds(project.workspaceId, dto.repositoryIds ?? []);
    const deliveryTargetIds = dto.deliveryTargetIds === undefined
      ? await this.defaultDeliveryTargetIds(projectId)
      : await this.resolveDeliveryTargetIds(projectId, dto.deliveryTargetIds);
    const enabled = dto.enabled ?? false;

    const feed = await this.prisma.briefingFeed.create({
      data: {
        projectId,
        name,
        enabled,
        dailyHour: dto.dailyHour ?? DEFAULT_BRIEFING_CUTOFF_HOUR,
        timezone: BRIEFING_TIMEZONE,
        autoSend: dto.autoSend ?? enabled,
        repositories: {
          create: repositoryIds.map((repositoryId) => ({ repositoryId })),
        },
        deliveryTargets: {
          create: deliveryTargetIds.map((deliveryTargetId) => ({ deliveryTargetId })),
        },
      },
      include: feedInclude,
    });
    return this.serialize(feed);
  }

  async updateFeed(id: string, dto: UpdateBriefingFeedDto) {
    const current = await this.requireFeed(id);
    const project = await this.ensureProject(current.projectId);
    const data: Prisma.BriefingFeedUpdateInput = {
      timezone: BRIEFING_TIMEZONE,
    };
    if (dto.name !== undefined) {
      const name = this.requireName(dto.name);
      await this.assertNameAvailable(current.projectId, name, id);
      data.name = name;
    }
    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
      data.autoSend = dto.enabled;
    }
    if (dto.dailyHour !== undefined) {
      data.dailyHour = dto.dailyHour;
      data.lastSchedulerSlot = null;
    }
    if (dto.autoSend !== undefined) {
      data.autoSend = dto.autoSend;
    }

    const repositoryIds = dto.repositoryIds === undefined
      ? undefined
      : await this.resolveRepositoryIds(project.workspaceId, dto.repositoryIds);
    const deliveryTargetIds = dto.deliveryTargetIds === undefined
      ? undefined
      : await this.resolveDeliveryTargetIds(current.projectId, dto.deliveryTargetIds);

    await this.prisma.briefingFeed.update({ where: { id }, data });
    if (repositoryIds !== undefined) {
      await this.prisma.briefingFeedRepository.deleteMany({ where: { feedId: id } });
      if (repositoryIds.length > 0) {
        await this.prisma.briefingFeedRepository.createMany({
          data: repositoryIds.map((repositoryId) => ({ feedId: id, repositoryId })),
        });
      }
    }
    if (deliveryTargetIds !== undefined) {
      await this.prisma.briefingFeedDeliveryTarget.deleteMany({ where: { feedId: id } });
      if (deliveryTargetIds.length > 0) {
        await this.prisma.briefingFeedDeliveryTarget.createMany({
          data: deliveryTargetIds.map((deliveryTargetId) => ({ feedId: id, deliveryTargetId })),
        });
      }
    }
    return this.getFeed(id);
  }

  async deleteFeed(id: string) {
    await this.requireFeed(id);
    const briefingCount = await this.prisma.briefing.count({ where: { feedId: id } });
    if (briefingCount > 0) {
      throw new ConflictException('已有简报记录，不能删除。可关闭定时。');
    }
    await this.prisma.briefingFeed.delete({ where: { id } });
    return { success: true };
  }

  private serialize(feed: BriefingFeedRecord) {
    return {
      id: feed.id,
      projectId: feed.projectId,
      name: feed.name,
      enabled: feed.enabled,
      dailyHour: feed.dailyHour,
      timezone: feed.timezone,
      autoSend: feed.autoSend,
      lastSchedulerSlot: feed.lastSchedulerSlot,
      lastSchedulerRunAt: feed.lastSchedulerRunAt,
      lastSchedulerMessage: feed.lastSchedulerMessage,
      repositoryIds: feed.repositories.map((row) => row.repositoryId).sort(),
      deliveryTargetIds: feed.deliveryTargets.map((row) => row.deliveryTargetId).sort(),
      createdAt: feed.createdAt,
      updatedAt: feed.updatedAt,
    };
  }

  private async requireFeed(id: string) {
    const feed = await this.prisma.briefingFeed.findUnique({
      where: { id },
      include: feedInclude,
    });
    if (!feed) {
      throw new NotFoundException('简报不存在。');
    }
    return feed;
  }

  private async ensureProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, workspaceId: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return project;
  }

  private requireName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('名称不能为空。');
    }
    return trimmed;
  }

  private async assertNameAvailable(projectId: string, name: string, exceptId?: string) {
    const existing = await this.prisma.briefingFeed.findFirst({
      where: {
        projectId,
        name,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('同项目已有同名简报。');
    }
  }

  private async resolveRepositoryIds(workspaceId: string, repositoryIds: string[]) {
    const uniqueIds = [...new Set(repositoryIds)];
    if (uniqueIds.length === 0) {
      return [];
    }
    const repositories = await this.prisma.repository.findMany({
      where: { id: { in: uniqueIds }, workspaceId },
      select: { id: true },
    });
    if (repositories.length !== uniqueIds.length) {
      throw new BadRequestException('仓库必须属于该项目的工作区。');
    }
    return uniqueIds;
  }

  private async defaultDeliveryTargetIds(projectId: string) {
    const targets = await this.prisma.deliveryTarget.findMany({
      where: { projectId, isActive: true, forBriefing: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return targets.map((target) => target.id);
  }

  private async resolveDeliveryTargetIds(projectId: string, deliveryTargetIds: string[]) {
    const uniqueIds = [...new Set(deliveryTargetIds)];
    if (uniqueIds.length === 0) {
      return [];
    }
    const targets = await this.prisma.deliveryTarget.findMany({
      where: { id: { in: uniqueIds }, projectId },
      select: { id: true },
    });
    if (targets.length !== uniqueIds.length) {
      throw new BadRequestException('投递目标必须属于该项目。');
    }
    return uniqueIds;
  }
}
