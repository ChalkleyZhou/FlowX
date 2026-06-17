import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  renderBriefingHtml,
  renderBriefingMarkdown,
} from './briefing-renderer';
import type { NormalizedBriefingEvent } from './briefing-events';
import { BriefingAiSummarizerService } from './briefing-ai-summarizer.service';
import { DeliveryTargetsService } from './delivery-targets.service';
import { GenerateBriefingDto } from './dto/generate-briefing.dto';
import { UpsertProjectBriefingConfigDto } from './dto/upsert-project-briefing-config.dto';
import {
  briefingDateWindow,
  BRIEFING_TIMEZONE,
  dateAtBeijingMidnight,
  DEFAULT_BRIEFING_CUTOFF_HOUR,
  resolveBriefingDate,
} from './briefing-time-window';

const DEFAULT_DAILY_HOUR = DEFAULT_BRIEFING_CUTOFF_HOUR;

type ProjectWithWorkspace = {
  id: string;
  name: string;
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
    private readonly briefingAiSummarizerService: BriefingAiSummarizerService,
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
        timezone: BRIEFING_TIMEZONE,
        autoSend: false,
        lastSchedulerSlot: null,
        lastSchedulerRunAt: null,
        lastSchedulerMessage: null,
        createdAt: null,
        updatedAt: null,
      }
    );
  }

  async upsertProjectConfig(projectId: string, dto: UpsertProjectBriefingConfigDto) {
    await this.ensureProjectExists(projectId);
    const updateData: {
      enabled?: boolean;
      dailyHour?: number;
      timezone: string;
      autoSend?: boolean;
      lastSchedulerSlot?: string | null;
    } = {
      timezone: BRIEFING_TIMEZONE,
    };
    if (dto.enabled !== undefined) {
      updateData.enabled = dto.enabled;
      updateData.autoSend = dto.enabled;
    }
    if (dto.dailyHour !== undefined) {
      updateData.dailyHour = dto.dailyHour;
      updateData.lastSchedulerSlot = null;
    }
    if (dto.autoSend !== undefined) {
      updateData.autoSend = dto.autoSend;
    }

    return this.prisma.projectBriefingConfig.upsert({
      where: { projectId },
      create: {
        projectId,
        enabled: dto.enabled ?? false,
        dailyHour: dto.dailyHour ?? DEFAULT_DAILY_HOUR,
        timezone: BRIEFING_TIMEZONE,
        autoSend: dto.autoSend ?? false,
      },
      update: updateData,
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
    const config = await this.prisma.projectBriefingConfig.findUnique({
      where: { projectId },
    });
    const cutoffHour = config?.dailyHour ?? DEFAULT_DAILY_HOUR;
    const briefingDate =
      dto.date?.trim() || resolveBriefingDate(new Date(), cutoffHour);
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
      date: briefingDate,
      projectId,
      workspaceId: project.workspaceId,
      repositoryIds,
      briefingSourceIds: sourceIds,
      cutoffHour,
    };
    const scopeKey = stableJson(scope);
    const date = dateAtBeijingMidnight(briefingDate);
    const existing = await this.prisma.briefing.findFirst({
      where: {
        projectId,
        date,
        scopeKey,
      },
    });

    if (existing && !dto.regenerate) {
      return existing;
    }

    const { start, end } = briefingDateWindow(briefingDate, cutoffHour);
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
    const rawPayloadByEventIndex = eventRows.map((row) => row.rawPayload);
    const aiSummary = await this.briefingAiSummarizerService.summarize({
      period: 'DAILY',
      date: briefingDate,
      rangeLabel: briefingDate,
      projectName: project.name,
      events,
      rawPayloadByEventIndex,
    });
    const markdownContent = renderBriefingMarkdown({
      date: briefingDate,
      projectName: project.name,
      events,
      rawPayloadByEventIndex,
      aiSummary,
    });
    const htmlContent = renderBriefingHtml({
      date: briefingDate,
      projectName: project.name,
      events,
      rawPayloadByEventIndex,
      aiSummary,
    });

    const generatedPayload = {
      scope: scope as Prisma.InputJsonValue,
      status: 'GENERATED',
      markdownContent,
      htmlContent,
      eventCount: events.length,
      generatedAt: new Date(),
      errorMessage: null,
    };

    if (existing) {
      return this.prisma.briefing.update({
        where: { id: existing.id },
        data: {
          ...generatedPayload,
          ...(dto.regenerate ? { sentAt: null } : {}),
        },
      });
    }

    return this.prisma.briefing.create({
      data: {
        projectId,
        workspaceId: project.workspaceId,
        date,
        scopeKey,
        ...generatedPayload,
      },
    });
  }

  async sendBriefing(briefingId: string) {
    const briefing = await this.prisma.briefing.findUnique({
      where: { id: briefingId },
      include: { project: { select: { name: true } } },
    });
    if (!briefing) {
      throw new NotFoundException('Briefing not found.');
    }
    return this.deliveryTargetsService.sendBriefing({
      id: briefing.id,
      projectId: briefing.projectId,
      projectName: briefing.project.name,
      date: briefing.date,
      markdownContent: briefing.markdownContent,
      htmlContent: briefing.htmlContent,
    });
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

function normalizeStoredEvent(value: Prisma.JsonValue): NormalizedBriefingEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored normalized briefing event is invalid.');
  }
  return value as unknown as NormalizedBriefingEvent;
}
