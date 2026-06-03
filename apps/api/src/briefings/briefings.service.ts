import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  renderBriefingHtml,
  renderBriefingMarkdown,
} from './briefing-renderer';
import type { NormalizedBriefingEvent } from './briefing-events';
import { DeliveryTargetsService } from './delivery-targets.service';
import { GenerateBriefingDto } from './dto/generate-briefing.dto';
import { UpsertProjectBriefingConfigDto } from './dto/upsert-project-briefing-config.dto';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_DAILY_HOUR = 18;

type ProjectWithWorkspace = {
  id: string;
  workspaceId: string;
  workspace: {
    repositories: Array<{ id: string }>;
  };
};

@Injectable()
export class BriefingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveryTargetsService: DeliveryTargetsService,
  ) {}

  async getProjectConfig(projectId: string) {
    await this.ensureProjectExists(projectId);
    const config = await this.prisma.projectBriefingConfig.findUnique({
      where: { projectId },
    });

    return (
      config ?? {
        projectId,
        enabled: false,
        dailyHour: DEFAULT_DAILY_HOUR,
        timezone: DEFAULT_TIMEZONE,
        autoSend: false,
        createdAt: null,
        updatedAt: null,
      }
    );
  }

  async upsertProjectConfig(projectId: string, dto: UpsertProjectBriefingConfigDto) {
    await this.ensureProjectExists(projectId);
    const data = {
      enabled: dto.enabled ?? false,
      dailyHour: dto.dailyHour ?? DEFAULT_DAILY_HOUR,
      timezone: dto.timezone?.trim() || DEFAULT_TIMEZONE,
      autoSend: dto.autoSend ?? false,
    };

    return this.prisma.projectBriefingConfig.upsert({
      where: { projectId },
      create: {
        projectId,
        ...data,
      },
      update: data,
    });
  }

  async listProjectBriefings(projectId: string) {
    await this.ensureProjectExists(projectId);
    return this.prisma.briefing.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        deliveryLogs: {
          include: { deliveryTarget: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async getBriefing(id: string) {
    const briefing = await this.prisma.briefing.findUnique({
      where: { id },
      include: {
        project: true,
        workspace: true,
        deliveryLogs: {
          include: { deliveryTarget: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!briefing) {
      throw new NotFoundException('Briefing not found.');
    }
    return briefing;
  }

  async generateProjectBriefing(projectId: string, dto: GenerateBriefingDto) {
    const project = await this.getProjectForBriefing(projectId);
    const repositoryIds = project.workspace.repositories.map((repository) => repository.id).sort();
    const sources = await this.prisma.briefingSource.findMany({
      where: {
        workspaceId: project.workspaceId,
        repositoryId: { in: repositoryIds },
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const sourceIds = sources.map((source) => source.id).sort();
    const scope = {
      date: dto.date,
      projectId,
      workspaceId: project.workspaceId,
      repositoryIds,
      briefingSourceIds: sourceIds,
    };
    const scopeKey = stableJson(scope);
    const date = dateAtTimezoneStart(dto.date, DEFAULT_TIMEZONE);

    if (!dto.regenerate) {
      const existing = await this.prisma.briefing.findFirst({
        where: {
          projectId,
          date,
          scopeKey,
        },
      });
      if (existing) {
        return existing;
      }
    }

    const { start, end } = dateWindow(dto.date, DEFAULT_TIMEZONE);
    const eventRows = await this.prisma.briefingEvent.findMany({
      where: {
        briefingSourceId: { in: sourceIds },
        occurredAt: { gte: start, lt: end },
      },
      orderBy: { occurredAt: 'asc' },
    });
    const events = eventRows.map((row) =>
      normalizeStoredEvent(row.normalizedPayload),
    );
    const markdownContent = renderBriefingMarkdown({ date: dto.date, events });
    const htmlContent = renderBriefingHtml({ date: dto.date, events });

    return this.prisma.briefing.create({
      data: {
        projectId,
        workspaceId: project.workspaceId,
        date,
        scopeKey,
        scope: scope as Prisma.InputJsonValue,
        status: 'GENERATED',
        markdownContent,
        htmlContent,
        eventCount: events.length,
        generatedAt: new Date(),
      },
    });
  }

  async sendBriefing(briefingId: string) {
    const briefing = await this.prisma.briefing.findUnique({
      where: { id: briefingId },
    });
    if (!briefing) {
      throw new NotFoundException('Briefing not found.');
    }
    return this.deliveryTargetsService.sendBriefing(briefing);
  }

  private async ensureProjectExists(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
  }

  private async getProjectForBriefing(projectId: string): Promise<ProjectWithWorkspace> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workspace: {
          include: {
            repositories: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return project;
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
      return nested;
    }
    return Object.keys(nested)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (nested as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}

function dateAtTimezoneStart(date: string, timezone: string) {
  if (timezone === DEFAULT_TIMEZONE) {
    return new Date(`${date}T00:00:00.000+08:00`);
  }
  return new Date(`${date}T00:00:00.000Z`);
}

function dateWindow(date: string, timezone: string) {
  const start = dateAtTimezoneStart(date, timezone);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function normalizeStoredEvent(value: Prisma.JsonValue): NormalizedBriefingEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored normalized briefing event is invalid.');
  }
  return value as unknown as NormalizedBriefingEvent;
}

