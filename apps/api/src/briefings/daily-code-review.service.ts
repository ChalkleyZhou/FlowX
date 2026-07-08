import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AiInvocationRecipient } from '../ai/ai-invocation-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { collectDailyCommits } from './briefing-commits';
import type { NormalizedBriefingEvent } from './briefing-events';
import {
  briefingDateWindow,
  dateAtBeijingMidnight,
  DEFAULT_BRIEFING_CUTOFF_HOUR,
  resolveBriefingDate,
} from './briefing-time-window';
import { DailyCodeReviewAiService } from './daily-code-review-ai.service';
import {
  buildRepositoryLookupById,
  buildRepositoryLookupByName,
  groupCommitsForDailyReview,
  resolveRepositoryForReview,
} from './daily-code-review-commits';
import {
  renderDailyCodeReviewHtml,
  renderDailyCodeReviewMarkdown,
  renderGeneratingDailyCodeReviewContent,
} from './daily-code-review-renderer';
import {
  deriveDailyCodeReviewStatus,
  normalizeReviewFindings,
  summarizeDailyCodeReviewErrors,
  type DailyCodeReviewUnitResult,
} from './daily-code-review.types';
import { DeliveryTargetsService } from './delivery-targets.service';
import type { WorkspaceContext } from '../common/types';
import { RepositorySyncService } from '../workspaces/repository-sync.service';
import type { RepositoryLookupEntry } from './daily-code-review-commits';
import {
  type BriefingAuthSession,
  toAiInvocationRecipient,
} from './briefing-auth-session';

const DEFAULT_DAILY_HOUR = DEFAULT_BRIEFING_CUTOFF_HOUR;

interface GenerateDailyCodeReviewOptions {
  date?: string;
  regenerate?: boolean;
}

interface GenerateDailyCodeReviewRuntimeOptions {
  async?: boolean;
}

type BuildDailyCodeReviewInput = {
  project: Awaited<ReturnType<DailyCodeReviewService['getProjectForReview']>>;
  date: string;
  groups: ReturnType<typeof groupCommitsForDailyReview>;
  repositoryLookupById: ReturnType<typeof buildRepositoryLookupById>;
  repositoryLookupByName: ReturnType<typeof buildRepositoryLookupByName>;
  recipient: AiInvocationRecipient | null;
};

@Injectable()
export class DailyCodeReviewService {
  private readonly logger = new Logger(DailyCodeReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyCodeReviewAiService: DailyCodeReviewAiService,
    private readonly deliveryTargetsService: DeliveryTargetsService,
    private readonly repositorySyncService: RepositorySyncService,
  ) {}

  async listProjectDailyCodeReviews(projectId: string) {
    await this.ensureProjectExists(projectId);
    return this.prisma.dailyCodeReview.findMany({
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

  async getDailyCodeReview(id: string) {
    const review = await this.prisma.dailyCodeReview.findUnique({
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
    if (!review) {
      throw new NotFoundException('Daily code review not found.');
    }
    return review;
  }

  async generateProjectDailyCodeReview(
    projectId: string,
    options: GenerateDailyCodeReviewOptions = {},
    authSession?: BriefingAuthSession,
    runtimeOptions?: GenerateDailyCodeReviewRuntimeOptions,
  ) {
    const project = await this.getProjectForReview(projectId);
    const config = await this.prisma.projectBriefingConfig.findUnique({
      where: { projectId },
    });
    const cutoffHour = config?.dailyHour ?? DEFAULT_DAILY_HOUR;
    const date = options.date?.trim() || resolveBriefingDate(new Date(), cutoffHour);
    const window = briefingDateWindow(date, cutoffHour);
    const recordDate = dateAtBeijingMidnight(date);

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
      date,
      rangeLabel: date,
      periodStart: window.start.toISOString(),
      periodEnd: window.end.toISOString(),
      projectId,
      workspaceId: project.workspaceId,
      repositoryIds,
      briefingSourceIds: sourceIds,
      cutoffHour,
    };
    const scopeKey = stableJson(scope);

    const existing = await this.prisma.dailyCodeReview.findFirst({
      where: {
        projectId,
        scopeKey,
      },
    });
    if (existing && !options.regenerate) {
      return existing;
    }

    const eventRows = await this.prisma.briefingEvent.findMany({
      where: {
        briefingSourceId: { in: sourceIds },
        occurredAt: { gte: window.start, lt: window.end },
      },
      orderBy: { occurredAt: 'asc' },
    });
    const rawPayloadByEventIndex = eventRows.map((row) => row.rawPayload);
    const eventInputs = eventRows.map((row, index) => ({
      event: normalizeStoredEvent(row.normalizedPayload),
      rawPayload: rawPayloadByEventIndex[index],
      repositoryId: row.repositoryId,
    }));
    const commits = collectDailyCommits(eventInputs);
    const groups = groupCommitsForDailyReview(commits);
    const repositoryRecords = project.workspace.repositories.map((repository) => ({
      id: repository.id,
      name: repository.name,
      url: repository.url,
      defaultBranch: repository.defaultBranch,
      currentBranch: repository.currentBranch,
      localPath: repository.localPath,
      syncStatus: repository.syncStatus,
    }));
    const repositoryLookupById = buildRepositoryLookupById(repositoryRecords);
    const repositoryLookupByName = buildRepositoryLookupByName(repositoryRecords);
    const recipient = toAiInvocationRecipient(authSession);
    const buildInput: BuildDailyCodeReviewInput = {
      project,
      date,
      groups,
      repositoryLookupById,
      repositoryLookupByName,
      recipient,
    };

    if (runtimeOptions?.async) {
      const generatingContent = renderGeneratingDailyCodeReviewContent({
        projectName: project.name,
        date,
        rangeLabel: date,
        unitCount: groups.length,
      });
      const pendingPayload = {
        scope: scope as Prisma.InputJsonValue,
        status: 'GENERATING',
        unitsJson: [] as unknown as Prisma.InputJsonValue,
        markdownContent: generatingContent.markdownContent,
        htmlContent: generatingContent.htmlContent,
        generatedAt: null,
        errorMessage: null,
        sentAt: null,
      };

      const review = existing
        ? await this.prisma.dailyCodeReview.update({
            where: { id: existing.id },
            data: pendingPayload,
          })
        : await this.prisma.dailyCodeReview.create({
            data: {
              projectId,
              workspaceId: project.workspaceId,
              date: recordDate,
              scopeKey,
              ...pendingPayload,
            },
          });

      this.enqueueDailyCodeReviewCompletion({
        reviewId: review.id,
        scope,
        regenerate: options.regenerate,
        ...buildInput,
      });
      return review;
    }

    const generatedPayload = await this.buildGeneratedDailyCodeReviewPayload(buildInput);
    const payload = {
      scope: scope as Prisma.InputJsonValue,
      ...generatedPayload,
      ...(options.regenerate ? { sentAt: null } : {}),
    };

    if (existing) {
      return this.prisma.dailyCodeReview.update({
        where: { id: existing.id },
        data: payload,
      });
    }

    return this.prisma.dailyCodeReview.create({
      data: {
        projectId,
        workspaceId: project.workspaceId,
        date: recordDate,
        scopeKey,
        ...payload,
      },
    });
  }

  private async buildGeneratedDailyCodeReviewPayload(input: BuildDailyCodeReviewInput) {
    const { project, date, groups, repositoryLookupById, repositoryLookupByName, recipient } = input;
    const units: DailyCodeReviewUnitResult[] = [];
    for (const group of groups) {
      const repository = resolveRepositoryForReview(
        group,
        repositoryLookupById,
        repositoryLookupByName,
      );
      const unitCommits = group.commits.map((commit) => ({
        id: commit.id,
        message: commit.message,
        author: commit.author,
      }));

      if (!repository) {
        units.push({
          repositoryName: group.repositoryName,
          repositoryId: group.repositoryId,
          ref: group.ref,
          commits: unitCommits,
          status: 'SKIPPED_NO_REPO',
          errorMessage: `未找到仓库「${group.repositoryName}」对应的登记记录，请确认简报数据源已绑定到工作区仓库。`,
        });
        continue;
      }

      const repositoryName = repository.name;

      let preparedRepository: RepositoryLookupEntry;
      try {
        const synced = await this.repositorySyncService.ensureRepositoryReadyForReview(
          {
            id: repository.id,
            workspaceId: project.workspaceId,
            name: repository.name,
            url: repository.url,
            defaultBranch: repository.defaultBranch,
            currentBranch: repository.currentBranch,
            localPath: repository.localPath,
          },
          group.ref,
        );
        preparedRepository = {
          id: synced.id,
          name: synced.name,
          url: synced.url,
          defaultBranch: synced.defaultBranch,
          currentBranch: synced.currentBranch,
          localPath: synced.localPath,
          syncStatus: synced.syncStatus,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        units.push({
          repositoryName: group.repositoryName,
          repositoryId: repository.id,
          ref: group.ref,
          commits: unitCommits,
          status: 'FAILED',
          errorMessage: message,
        });
        continue;
      }

      if (!preparedRepository.localPath) {
        units.push({
          repositoryName,
          repositoryId: repository.id,
          ref: group.ref,
          commits: unitCommits,
          status: 'FAILED',
          errorMessage: '仓库同步后仍缺少本地路径，无法运行 Code Review。',
        });
        continue;
      }

      const aiOutput = await this.dailyCodeReviewAiService.reviewUnit({
        unit: {
          repositoryName,
          repositoryId: preparedRepository.id,
          localPath: preparedRepository.localPath,
          ref: group.ref,
          commits: unitCommits,
          date,
          rangeLabel: date,
        },
        workspace: toWorkspaceContext({
          ...project.workspace,
          repositories: project.workspace.repositories.map((item) =>
            item.id === preparedRepository.id ? { ...item, ...preparedRepository } : item,
          ),
        }),
        recipient,
      });

      units.push({
        repositoryName,
        repositoryId: preparedRepository.id,
        ref: group.ref,
        commits: unitCommits,
        status: aiOutput.status,
        skillHint: aiOutput.skillHint,
        errorMessage: aiOutput.errorMessage,
        findings:
          aiOutput.status === 'COMPLETED' ? normalizeReviewFindings(aiOutput) : undefined,
      });
    }

    const overallStatus = deriveDailyCodeReviewStatus(units);
    const markdownContent = renderDailyCodeReviewMarkdown({
      projectName: project.name,
      date,
      rangeLabel: date,
      units,
      overallStatus,
    });
    const htmlContent = renderDailyCodeReviewHtml({
      projectName: project.name,
      date,
      rangeLabel: date,
      units,
      overallStatus,
    });

    return {
      status: overallStatus,
      unitsJson: units as unknown as Prisma.InputJsonValue,
      markdownContent,
      htmlContent,
      generatedAt: new Date(),
      errorMessage: summarizeDailyCodeReviewErrors(units),
    };
  }

  private enqueueDailyCodeReviewCompletion(
    input: BuildDailyCodeReviewInput & {
      reviewId: string;
      scope: Record<string, unknown>;
      regenerate?: boolean;
    },
  ) {
    setTimeout(() => {
      void this.completeDailyCodeReviewGeneration(input);
    }, 0);
  }

  private async completeDailyCodeReviewGeneration(
    input: BuildDailyCodeReviewInput & {
      reviewId: string;
      scope: Record<string, unknown>;
      regenerate?: boolean;
    },
  ) {
    try {
      const generatedPayload = await this.buildGeneratedDailyCodeReviewPayload(input);
      await this.prisma.dailyCodeReview.update({
        where: { id: input.reviewId },
        data: {
          scope: input.scope as Prisma.InputJsonValue,
          ...generatedPayload,
          ...(input.regenerate ? { sentAt: null } : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Daily code review background generation failed: ${message}`);
      await this.prisma.dailyCodeReview.update({
        where: { id: input.reviewId },
        data: {
          status: 'FAILED',
          errorMessage: message,
          generatedAt: new Date(),
        },
      });
    }
  }

  async sendDailyCodeReview(reviewId: string) {
    const review = await this.prisma.dailyCodeReview.findUnique({
      where: { id: reviewId },
      include: { project: { select: { name: true } } },
    });
    if (!review) {
      throw new NotFoundException('Daily code review not found.');
    }

    const delivery = await this.deliveryTargetsService.sendDailyCodeReview({
      id: review.id,
      projectId: review.projectId,
      projectName: review.project.name,
      date: review.date,
      markdownContent: review.markdownContent,
      htmlContent: review.htmlContent,
    });

    return delivery;
  }

  private async ensureProjectExists(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
  }

  private async getProjectForReview(projectId: string) {
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

function toWorkspaceContext(
  workspace: {
    id: string;
    name: string;
    description?: string | null;
    repositories: Array<{
      id: string;
      name: string;
      url: string;
      defaultBranch: string | null;
      currentBranch: string | null;
      localPath: string | null;
      syncStatus: string;
    }>;
  },
): WorkspaceContext {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description ?? null,
    repositories: workspace.repositories.map((repository) => ({
      id: repository.id,
      name: repository.name,
      url: repository.url,
      defaultBranch: repository.defaultBranch,
      currentBranch: repository.currentBranch,
      localPath: repository.localPath,
      syncStatus: repository.syncStatus,
    })),
  };
}
