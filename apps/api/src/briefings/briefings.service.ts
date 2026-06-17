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
import { GenerateBriefingDto, type BriefingPeriod } from './dto/generate-briefing.dto';
import { UpsertProjectBriefingConfigDto } from './dto/upsert-project-briefing-config.dto';
import {
  briefingDateWindow,
  briefingWeekWindow,
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

interface BriefingPeriodPlan {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  windowStart: Date;
  windowEnd: Date;
  recordDate: Date;
}

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
    const requestedDate =
      dto.date?.trim() || resolveBriefingDate(new Date(), cutoffHour);
    const periodPlan = resolvePeriodPlan({
      period: dto.period ?? 'DAILY',
      date: requestedDate,
      cutoffHour,
    });
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
      period: periodPlan.period,
      date: periodPlan.date,
      rangeLabel: periodPlan.rangeLabel,
      periodStart: periodPlan.windowStart.toISOString(),
      periodEnd: periodPlan.windowEnd.toISOString(),
      projectId,
      workspaceId: project.workspaceId,
      repositoryIds,
      briefingSourceIds: sourceIds,
      cutoffHour: periodPlan.period === 'DAILY' ? cutoffHour : null,
    };
    const scopeKey = stableJson(scope);
    const existing = await this.prisma.briefing.findFirst({
      where: {
        projectId,
        date: periodPlan.recordDate,
        scopeKey,
      },
    });

    if (existing && !dto.regenerate) {
      return existing;
    }

    const eventRows = await this.prisma.briefingEvent.findMany({
      where: {
        briefingSourceId: { in: sourceIds },
        occurredAt: { gte: periodPlan.windowStart, lt: periodPlan.windowEnd },
      },
      orderBy: { occurredAt: 'asc' },
    });
    const events = eventRows.map((row) =>
      normalizeStoredEvent(row.normalizedPayload),
    );
    const rawPayloadByEventIndex = eventRows.map((row) => row.rawPayload);
    const aiSummary = await this.briefingAiSummarizerService.summarize({
      period: periodPlan.period,
      date: periodPlan.date,
      rangeLabel: periodPlan.rangeLabel,
      projectName: project.name,
      events,
      rawPayloadByEventIndex,
    });
    const markdownContent = renderBriefingMarkdown({
      period: periodPlan.period,
      date: periodPlan.date,
      rangeLabel: periodPlan.rangeLabel,
      projectName: project.name,
      events,
      rawPayloadByEventIndex,
      aiSummary,
    });
    const htmlContent = renderBriefingHtml({
      period: periodPlan.period,
      date: periodPlan.date,
      rangeLabel: periodPlan.rangeLabel,
      projectName: project.name,
      events,
      rawPayloadByEventIndex,
      aiSummary,
    });

    const generatedPayload = {
      scope: scope as Prisma.InputJsonValue,
      period: periodPlan.period,
      periodStart: periodPlan.windowStart,
      periodEnd: periodPlan.windowEnd,
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
        date: periodPlan.recordDate,
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

function resolvePeriodPlan(input: {
  period: BriefingPeriod;
  date: string;
  cutoffHour: number;
}): BriefingPeriodPlan {
  if (input.period === 'WEEKLY') {
    const week = briefingWeekWindow(input.date);
    return {
      period: 'WEEKLY',
      date: week.startDate,
      rangeLabel: `${week.startDate} 至 ${week.endDate}`,
      windowStart: week.start,
      windowEnd: week.end,
      recordDate: week.start,
    };
  }

  const window = briefingDateWindow(input.date, input.cutoffHour);
  return {
    period: 'DAILY',
    date: input.date,
    rangeLabel: input.date,
    windowStart: window.start,
    windowEnd: window.end,
    recordDate: dateAtBeijingMidnight(input.date),
  };
}

function normalizeStoredEvent(value: Prisma.JsonValue): NormalizedBriefingEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored normalized briefing event is invalid.');
  }
  return value as unknown as NormalizedBriefingEvent;
}
