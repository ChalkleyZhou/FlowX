import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AiInvocationRecipient } from '../ai/ai-invocation-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { collectDailyCommits } from '../briefings/briefing-commits';
import type { NormalizedBriefingEvent } from '../briefings/briefing-events';
import {
  briefingDateWindow,
  dateAtBeijingMidnight,
  DEFAULT_BRIEFING_CUTOFF_HOUR,
  resolveBriefingDate,
} from '../briefings/briefing-time-window';
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
import { DeliveryTargetsService } from '../briefings/delivery-targets.service';
import type { DailyCodeReviewRepositoryMapEntry, WorkspaceContext } from '../common/types';
import { RepositorySyncService } from '../workspaces/repository-sync.service';
import type { RepositoryLookupEntry } from './daily-code-review-commits';
import {
  type BriefingAuthSession,
  toAiInvocationRecipient,
} from '../briefings/briefing-auth-session';

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
  allowedRepoIds: string[];
  groups: ReturnType<typeof groupCommitsForDailyReview>;
  repositoryLookupById: ReturnType<typeof buildRepositoryLookupById>;
  repositoryLookupByName: ReturnType<typeof buildRepositoryLookupByName>;
  recipient: AiInvocationRecipient | null;
  periodStart: Date;
  periodEnd: Date;
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
    const config = await this.prisma.projectCodeReviewConfig.findUnique({
      where: { projectId },
    });
    const cutoffHour = config?.dailyHour ?? DEFAULT_DAILY_HOUR;
    const date = options.date?.trim() || resolveBriefingDate(new Date(), cutoffHour);
    const window = briefingDateWindow(date, cutoffHour);
    const recordDate = dateAtBeijingMidnight(date);

    const repositoryIds = project.workspace.repositories.map((repository) => repository.id).sort();
    // Default scope is every repository in the workspace. CodeReviewSource rows with
    // isActive=false are explicit opt-outs; missing/active rows do not limit inclusion.
    const excludedSources = await this.prisma.codeReviewSource.findMany({
      where: {
        workspaceId: project.workspaceId,
        repositoryId: { in: repositoryIds },
        isActive: false,
      },
      orderBy: { createdAt: 'asc' },
    });
    const excludedRepoIds = excludedSources.map((source) => source.repositoryId).sort();
    const excludedRepoIdSet = new Set(excludedRepoIds);
    const allowedRepoIds = new Set(
      repositoryIds.filter((repositoryId) => !excludedRepoIdSet.has(repositoryId)),
    );

    const scopeBase = {
      date,
      rangeLabel: date,
      periodStart: window.start.toISOString(),
      periodEnd: window.end.toISOString(),
      projectId,
      workspaceId: project.workspaceId,
      repositoryIds,
      excludedRepositoryIds: excludedRepoIds,
      cutoffHour,
    };

    if (repositoryIds.length === 0 || allowedRepoIds.size === 0) {
      const scope = { ...scopeBase, briefingSourceIds: [] as string[] };
      const scopeKey = stableJson(scope);
      const existing = await this.prisma.dailyCodeReview.findFirst({
        where: { projectId, scopeKey },
      });
      if (existing && !options.regenerate) {
        return existing;
      }

      const payload = {
        scope: scope as Prisma.InputJsonValue,
        ...this.buildEmptyCodeReviewSourcesPayload(project.name, date, {
          reason: repositoryIds.length === 0 ? 'NO_REPOSITORIES' : 'ALL_EXCLUDED',
        }),
        ...(options.regenerate ? { sentAt: null } : {}),
      };

      if (existing) {
        return this.prisma.dailyCodeReview.update({ where: { id: existing.id }, data: payload });
      }
      return this.prisma.dailyCodeReview.create({
        data: { projectId, workspaceId: project.workspaceId, date: recordDate, scopeKey, ...payload },
      });
    }

    const sources = await this.prisma.briefingSource.findMany({
      where: {
        workspaceId: project.workspaceId,
        repositoryId: { in: [...allowedRepoIds] },
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const sourceIds = sources.map((source) => source.id).sort();
    const scope = { ...scopeBase, briefingSourceIds: sourceIds };
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

    const eventRows = await this.prisma.briefingEvent.findMany({
      where: {
        briefingSourceId: { in: sourceIds },
        occurredAt: { gte: window.start, lt: window.end },
      },
      orderBy: { occurredAt: 'asc' },
    });
    const rawPayloadByEventIndex = eventRows.map((row) => row.rawPayload);
    const eventInputs = eventRows
      .filter((row) => allowedRepoIds.has(row.repositoryId))
      .map((row, index) => ({
        event: normalizeStoredEvent(row.normalizedPayload),
        rawPayload: rawPayloadByEventIndex[index],
        repositoryId: row.repositoryId,
      }));
    const commits = collectDailyCommits(eventInputs);
    const groups = groupCommitsForDailyReview(commits);
    const recipient = toAiInvocationRecipient(authSession);
    const allowedRepoIdList = [...allowedRepoIds].sort();
    const buildInput: BuildDailyCodeReviewInput = {
      project,
      date,
      allowedRepoIds: allowedRepoIdList,
      groups,
      repositoryLookupById,
      repositoryLookupByName,
      recipient,
      periodStart: window.start,
      periodEnd: window.end,
    };

    if (runtimeOptions?.async) {
      const generatingContent = renderGeneratingDailyCodeReviewContent({
        projectName: project.name,
        date,
        rangeLabel: date,
        unitCount: allowedRepoIdList.length,
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

  /**
   * Empty-run when the workspace has no repositories, or every repository was
   * explicitly excluded via inactive CodeReviewSource rows.
   */
  private buildEmptyCodeReviewSourcesPayload(
    projectName: string,
    date: string,
    options: { reason: 'NO_REPOSITORIES' | 'ALL_EXCLUDED' },
  ) {
    const units: DailyCodeReviewUnitResult[] = [];
    const overallStatus = 'SKIPPED_NO_CR_SOURCES';
    const markdownContent = renderDailyCodeReviewMarkdown({
      projectName,
      date,
      rangeLabel: date,
      units,
      overallStatus,
    });
    const htmlContent = renderDailyCodeReviewHtml({
      projectName,
      date,
      rangeLabel: date,
      units,
      overallStatus,
    });
    const errorMessage =
      options.reason === 'NO_REPOSITORIES'
        ? '工作区尚未登记任何代码仓库，无法进行 Code Review。'
        : '工作区仓库均已从 Code Review 范围中排除，本次为空跑。可在「Code Review 数据源」中恢复纳入。';

    return {
      status: overallStatus,
      unitsJson: units as unknown as Prisma.InputJsonValue,
      markdownContent,
      htmlContent,
      generatedAt: new Date(),
      errorMessage,
    };
  }

  private async buildGeneratedDailyCodeReviewPayload(input: BuildDailyCodeReviewInput) {
    const {
      project,
      date,
      allowedRepoIds,
      groups,
      repositoryLookupById,
      repositoryLookupByName,
      recipient,
      periodStart,
      periodEnd,
    } = input;

    const commitsByRepositoryId = new Map<
      string,
      Array<{ id: string; message: string; author?: string }>
    >();
    for (const group of groups) {
      const repository = resolveRepositoryForReview(
        group,
        repositoryLookupById,
        repositoryLookupByName,
      );
      if (!repository) {
        continue;
      }
      const existing = commitsByRepositoryId.get(repository.id) ?? [];
      for (const commit of group.commits) {
        existing.push({
          id: commit.id,
          message: commit.message,
          author: commit.author,
        });
      }
      commitsByRepositoryId.set(repository.id, existing);
    }

    // Sandbox every included repo up front so `workspaceRepositoryMap` reflects
    // the full, successfully-sandboxed set on every unit sent to the AI —
    // not just the repos processed before a given repo in the loop.
    const sandboxByRepositoryId = new Map<
      string,
      { localPath: string; branch: string; syncStatus: 'READY' | 'ERROR'; syncError?: string }
    >();
    for (const repositoryId of allowedRepoIds) {
      const repository = repositoryLookupById.get(repositoryId);
      if (!repository) {
        continue;
      }
      const branch = repository.currentBranch || repository.defaultBranch || 'main';
      const sandbox = await this.repositorySyncService.ensureCodeReviewSandbox(
        {
          id: repository.id,
          workspaceId: project.workspaceId,
          name: repository.name,
          url: repository.url,
          defaultBranch: repository.defaultBranch,
          currentBranch: repository.currentBranch,
        },
        branch,
      );
      sandboxByRepositoryId.set(repositoryId, sandbox);
    }

    const workspaceRepositoryMap: DailyCodeReviewRepositoryMapEntry[] = allowedRepoIds
      .map((repositoryId) => {
        const repository = repositoryLookupById.get(repositoryId);
        const sandbox = sandboxByRepositoryId.get(repositoryId);
        if (!repository || !sandbox || sandbox.syncStatus !== 'READY') {
          return null;
        }
        return {
          name: repository.name,
          repositoryId: repository.id,
          localPath: sandbox.localPath,
        };
      })
      .filter((entry): entry is DailyCodeReviewRepositoryMapEntry => entry !== null);

    const units: DailyCodeReviewUnitResult[] = [];
    for (const repositoryId of allowedRepoIds) {
      const repository = repositoryLookupById.get(repositoryId);
      if (!repository) {
        continue;
      }

      const branch = repository.currentBranch || repository.defaultBranch || 'main';
      let unitCommits = commitsByRepositoryId.get(repository.id) ?? [];
      const repositoryName = repository.name;
      const sandbox = sandboxByRepositoryId.get(repositoryId);

      if (!sandbox || sandbox.syncStatus === 'ERROR') {
        units.push({
          repositoryName,
          repositoryId: repository.id,
          ref: branch,
          commits: unitCommits,
          status: 'FAILED',
          errorMessage: sandbox?.syncError?.trim() || 'Code Review 沙箱同步失败，无法运行审查。',
        });
        continue;
      }

      // Optional commit context from the sandbox only — never sync/checkout the main tree.
      if (unitCommits.length === 0) {
        try {
          const gitCommits = await this.repositorySyncService.collectRecentCommitsFromLocalPath(
            sandbox.localPath,
            { branch, since: periodStart, until: periodEnd },
          );
          unitCommits = gitCommits.map((commit) => ({
            id: commit.id,
            message: commit.message,
            author: commit.author,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to collect sandbox git commits for repository ${repository.id}: ${message}`,
          );
        }
      }

      let commitDiffBundle = '';
      if (sandbox.localPath && unitCommits.length > 0) {
        try {
          commitDiffBundle = await this.repositorySyncService.buildCommitDiffBundle(
            sandbox.localPath,
            unitCommits,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to build commit diff bundle for repository ${repository.id}: ${message}`,
          );
        }
      }

      const preparedRepository: RepositoryLookupEntry = {
        id: repository.id,
        name: repository.name,
        url: repository.url,
        defaultBranch: repository.defaultBranch,
        currentBranch: sandbox.branch || branch,
        localPath: sandbox.localPath,
        syncStatus: sandbox.syncStatus,
      };

      const aiOutput = await this.dailyCodeReviewAiService.reviewUnit({
        unit: {
          repositoryName,
          repositoryId: preparedRepository.id,
          localPath: preparedRepository.localPath,
          ref: branch,
          commits: unitCommits,
          date,
          rangeLabel: date,
          commitDiffBundle,
          workspaceRepositoryMap,
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
        ref: branch,
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
