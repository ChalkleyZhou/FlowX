import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AiInvocationRecipient } from '../ai/ai-invocation-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  renderBriefingHtml,
  renderBriefingMarkdown,
} from './briefing-renderer';
import type { NormalizedBriefingEvent } from './briefing-events';
import { BriefingAiSummarizerService } from './briefing-ai-summarizer.service';
import { DeliveryTargetsService } from './delivery-targets.service';
import { GenerateBriefingDto, type BriefingPeriod } from './dto/generate-briefing.dto';
import {
  briefingDateWindow,
  briefingWeekWindow,
  dateAtBeijingMidnight,
  DEFAULT_BRIEFING_CUTOFF_HOUR,
  resolveBriefingDate,
} from './briefing-time-window';
import {
  type BriefingAuthSession,
  toAiInvocationRecipient,
} from './briefing-auth-session';

const DEFAULT_DAILY_HOUR = DEFAULT_BRIEFING_CUTOFF_HOUR;

interface BriefingPeriodPlan {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  windowStart: Date;
  windowEnd: Date;
  recordDate: Date;
}

interface GenerateBriefingOptions {
  async?: boolean;
}

interface BuildBriefingContentInput {
  periodPlan: BriefingPeriodPlan;
  projectName: string;
  recipient: AiInvocationRecipient | null;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex: unknown[];
}

@Injectable()
export class BriefingsService {
  private readonly logger = new Logger(BriefingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveryTargetsService: DeliveryTargetsService,
    private readonly briefingAiSummarizerService: BriefingAiSummarizerService,
  ) {}

  async listProjectBriefingsPage(projectId: string, query: PaginationQuery = {}) {
    const paging = parsePagination(query);
    await this.ensureProjectExists(projectId);
    const items = await this.prisma.briefing.findMany({
      skip: paging.skip, take: paging.take,
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        feed: { select: { id: true, name: true } },
        deliveryLogs: {
          take: 1,
          include: { deliveryTarget: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        },
      },
    });
    const total = await this.prisma.briefing.count({ where: { projectId } });
    return pageResult(items, total, paging);
  }

  async listProjectBriefings(projectId: string) {
    await this.ensureProjectExists(projectId);
    return this.prisma.briefing.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        feed: { select: { id: true, name: true } },
        deliveryLogs: {
          include: { deliveryTarget: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async listDeliveryLogs(id: string, query: PaginationQuery = {}) {
    const paging = parsePagination(query);
    await this.prisma.briefing.findUniqueOrThrow({ where: { id }, select: { id: true } });
    const where = { briefingId: id };
    const [items, total] = await Promise.all([this.prisma.deliveryLog.findMany({ where, skip: paging.skip, take: paging.take, include: { deliveryTarget: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), this.prisma.deliveryLog.count({ where })]);
    return pageResult(items, total, paging);
  }

  async getBriefing(id: string) {
    const briefing = await this.prisma.briefing.findUnique({
      where: { id },
      include: {
        project: true,
        workspace: true,
        deliveryLogs: {
          take: 20,
          include: { deliveryTarget: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        },
      },
    });
    if (!briefing) {
      throw new NotFoundException('Briefing not found.');
    }
    return briefing;
  }

  async generateFeedBriefing(
    feedId: string,
    dto: GenerateBriefingDto,
    authSession?: BriefingAuthSession,
    options?: GenerateBriefingOptions,
  ) {
    const feed = await this.prisma.briefingFeed.findUnique({
      where: { id: feedId },
      include: {
        repositories: true,
        project: {
          include: {
            workspace: {
              include: {
                repositories: { orderBy: { createdAt: 'asc' } },
              },
            },
          },
        },
      },
    });
    if (!feed) {
      throw new NotFoundException('简报不存在。');
    }
    const project = feed.project;
    const projectId = project.id;
    const cutoffHour = feed.dailyHour ?? DEFAULT_DAILY_HOUR;
    const requestedDate =
      dto.date?.trim() || resolveBriefingDate(new Date(), cutoffHour);
    const periodPlan = resolvePeriodPlan({
      period: dto.period ?? 'DAILY',
      date: requestedDate,
      cutoffHour,
    });
    const selectedRepositoryIds = new Set(feed.repositories.map((row) => row.repositoryId));
    const repositoryIds = project.workspace.repositories
      .map((repository) => repository.id)
      .filter((repositoryId) => selectedRepositoryIds.has(repositoryId))
      .sort();
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
      feedId,
      projectId,
      workspaceId: project.workspaceId,
      repositoryIds,
      briefingSourceIds: sourceIds,
      cutoffHour: periodPlan.period === 'DAILY' ? cutoffHour : null,
    };
    const scopeKey = stableJson(scope);
    const existing = await this.prisma.briefing.findFirst({
      where: {
        feedId,
        date: periodPlan.recordDate,
        period: periodPlan.period,
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
    const recipient = toAiInvocationRecipient(authSession);

    if (options?.async) {
      const pendingPayload = {
        scope: scope as Prisma.InputJsonValue,
        period: periodPlan.period,
        periodStart: periodPlan.windowStart,
        periodEnd: periodPlan.windowEnd,
        status: 'GENERATING',
        markdownContent: renderBriefingMarkdown({
          period: periodPlan.period,
          date: periodPlan.date,
          rangeLabel: periodPlan.rangeLabel,
          projectName: project.name,
          events,
          rawPayloadByEventIndex,
          aiSummary: buildGeneratingSummary(periodPlan.period),
        }),
        htmlContent: renderBriefingHtml({
          period: periodPlan.period,
          date: periodPlan.date,
          rangeLabel: periodPlan.rangeLabel,
          projectName: project.name,
          events,
          rawPayloadByEventIndex,
          aiSummary: buildGeneratingSummary(periodPlan.period),
        }),
        eventCount: events.length,
        generatedAt: null,
        errorMessage: null,
        sentAt: null,
      };

      const briefing = existing
        ? await this.prisma.briefing.update({
            where: { id: existing.id },
            data: pendingPayload,
          })
        : await this.prisma.briefing.create({
            data: {
              feedId,
              projectId,
              workspaceId: project.workspaceId,
              date: periodPlan.recordDate,
              scopeKey,
              ...pendingPayload,
            },
          });

      this.enqueueBriefingCompletion({
        briefingId: briefing.id,
        periodPlan,
        projectName: project.name,
        recipient,
        events,
        rawPayloadByEventIndex,
      });
      return briefing;
    }

    const generatedPayload = await this.buildGeneratedBriefingPayload({
      periodPlan,
      projectName: project.name,
      recipient,
      events,
      rawPayloadByEventIndex,
    });

    if (existing) {
      return this.prisma.briefing.update({
        where: { id: existing.id },
        data: {
          scope: scope as Prisma.InputJsonValue,
          period: periodPlan.period,
          periodStart: periodPlan.windowStart,
          periodEnd: periodPlan.windowEnd,
          ...generatedPayload,
          ...(dto.regenerate ? { sentAt: null } : {}),
        },
      });
    }

    return this.prisma.briefing.create({
      data: {
        feedId,
        projectId,
        workspaceId: project.workspaceId,
        date: periodPlan.recordDate,
        scopeKey,
        scope: scope as Prisma.InputJsonValue,
        period: periodPlan.period,
        periodStart: periodPlan.windowStart,
        periodEnd: periodPlan.windowEnd,
        ...generatedPayload,
      },
    });
  }

  private async buildGeneratedBriefingPayload(input: BuildBriefingContentInput) {
    const aiSummary = await this.briefingAiSummarizerService.summarize({
      period: input.periodPlan.period,
      date: input.periodPlan.date,
      rangeLabel: input.periodPlan.rangeLabel,
      projectName: input.projectName,
      recipient: input.recipient,
      events: input.events,
      rawPayloadByEventIndex: input.rawPayloadByEventIndex,
    });
    const markdownContent = renderBriefingMarkdown({
      period: input.periodPlan.period,
      date: input.periodPlan.date,
      rangeLabel: input.periodPlan.rangeLabel,
      projectName: input.projectName,
      events: input.events,
      rawPayloadByEventIndex: input.rawPayloadByEventIndex,
      aiSummary,
    });
    const htmlContent = renderBriefingHtml({
      period: input.periodPlan.period,
      date: input.periodPlan.date,
      rangeLabel: input.periodPlan.rangeLabel,
      projectName: input.projectName,
      events: input.events,
      rawPayloadByEventIndex: input.rawPayloadByEventIndex,
      aiSummary,
    });

    return {
      status: 'GENERATED',
      markdownContent,
      htmlContent,
      eventCount: input.events.length,
      generatedAt: new Date(),
      errorMessage: null,
    };
  }

  private enqueueBriefingCompletion(input: BuildBriefingContentInput & { briefingId: string }) {
    setTimeout(() => {
      void this.completeBriefingGeneration(input);
    }, 0);
  }

  private async completeBriefingGeneration(input: BuildBriefingContentInput & { briefingId: string }) {
    try {
      const generatedPayload = await this.buildGeneratedBriefingPayload(input);
      await this.prisma.briefing.update({
        where: { id: input.briefingId },
        data: generatedPayload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Briefing background generation failed: ${message}`);
      await this.prisma.briefing.update({
        where: { id: input.briefingId },
        data: {
          status: 'FAILED',
          errorMessage: message,
          generatedAt: new Date(),
        },
      });
    }
  }

  async sendBriefing(briefingId: string) {
    const briefing = await this.prisma.briefing.findUnique({
      where: { id: briefingId },
      include: {
        project: { select: { name: true } },
        feed: { include: { deliveryTargets: true } },
      },
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
      deliveryTargetIds: briefing.feed.deliveryTargets.map((row) => row.deliveryTargetId),
    });
  }

  private async ensureProjectExists(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
  }

}

function buildGeneratingSummary(period: BriefingPeriod) {
  return {
    source: 'fallback' as const,
    headline: period === 'WEEKLY' ? '本周概览生成中' : '今日概览生成中',
    summaryParagraph: 'AI 正在后台整理项目变化，稍后会自动更新。',
    topics: [],
    openQuestions: [],
  };
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
