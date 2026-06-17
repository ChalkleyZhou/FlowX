import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_EXECUTOR_REGISTRY,
  type AIExecutorProvider,
  type AIExecutorRegistry,
} from '../ai/ai-executor';
import { AiInvocationContextService } from '../ai/ai-invocation-context.service';
import type { AiInvocationRecipient } from '../ai/ai-invocation-context.service';
import { CodexAiExecutor } from '../ai/codex-ai.executor';
import { buildBriefingSummaryPrompt } from '../prompts/briefing-summary.prompt';
import { buildBriefingFacts, type BriefingFactsPayload } from './briefing-facts';
import type { NormalizedBriefingEvent } from './briefing-events';
import type { BriefingPeriod } from './dto/generate-briefing.dto';

const DEFAULT_BRIEFING_AI_TIMEOUT_MS = 180_000;

export interface BriefingCommitReference {
  repository: string;
  commitId: string;
  title: string;
}

export interface BriefingAiTopic {
  title: string;
  summary: string;
  modules: string[];
  commitReferences: BriefingCommitReference[];
}

export interface BriefingAiSummary {
  source: 'ai' | 'fallback';
  aiProvider?: AIExecutorProvider;
  headline: string;
  summaryParagraph: string;
  topics: BriefingAiTopic[];
  openQuestions: string[];
}

interface RawBriefingAiTopic {
  title: string;
  summary: string;
  modules: string[];
  commitReferences: Array<{
    repository: string;
    commitId: string;
  }>;
}

interface SummarizeInput {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  projectName: string;
  recipient?: AiInvocationRecipient | null;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
}

@Injectable()
export class BriefingAiSummarizerService {
  private readonly logger = new Logger(BriefingAiSummarizerService.name);

  constructor(
    @Inject(AI_EXECUTOR_REGISTRY)
    private readonly executorRegistry: AIExecutorRegistry,
    private readonly aiInvocationContextService: AiInvocationContextService,
  ) {}

  async summarize(input: SummarizeInput): Promise<BriefingAiSummary> {
    const facts = buildBriefingFacts(input);
    if (facts.overview.commitCount === 0 || !this.isAiEnabled()) {
      return this.buildFallbackSummary(facts);
    }

    try {
      const provider = this.resolveProvider();
      const context = await this.aiInvocationContextService.resolveInvocationContext(
        provider,
        input.recipient ?? null,
      );
      const executor = this.resolveStructuredExecutor(provider);
      const prompt = buildBriefingSummaryPrompt(facts);
      const raw = await executor.runStructuredJsonStage<{
        headline: string;
        summaryParagraph: string;
        topics: RawBriefingAiTopic[];
        openQuestions: string[];
      }>(
        'briefing-summary.output.schema.json',
        prompt,
        'briefing summary',
        context,
        { timeoutMs: resolveBriefingAiTimeoutMs() },
      );

      return {
        source: 'ai',
        aiProvider: provider,
        headline: raw.headline.trim(),
        summaryParagraph: raw.summaryParagraph.trim(),
        topics: this.resolveTopics(raw.topics ?? [], facts),
        openQuestions: (raw.openQuestions ?? []).map((item) => item.trim()).filter(Boolean),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Briefing AI summary failed, using fallback: ${message}`);
      return this.buildFallbackSummary(facts);
    }
  }

  private resolveStructuredExecutor(provider: AIExecutorProvider): CodexAiExecutor {
    if (provider !== 'codex' && provider !== 'cursor') {
      throw new Error(
        `Briefing AI summary requires codex or cursor executor (provider=${provider}).`,
      );
    }
    return this.executorRegistry.get(provider) as CodexAiExecutor;
  }

  private resolveProvider(): AIExecutorProvider {
    const override = process.env.FLOWX_BRIEFING_AI_PROVIDER?.trim().toLowerCase();
    if (override === 'cursor' || override === 'codex') {
      return override;
    }
    return this.aiInvocationContextService.getConfiguredDefaultProvider();
  }

  private isAiEnabled() {
    if (process.env.FLOWX_BRIEFING_AI_DISABLED === 'true') {
      return false;
    }
    return process.env.FLOWX_BRIEFING_AI_ENABLED !== 'false';
  }

  private buildFallbackSummary(facts: BriefingFactsPayload): BriefingAiSummary {
    const emptyCopy =
      facts.period === 'WEEKLY'
        ? '本周暂无可归纳的项目变化。'
        : '今日暂无可归纳的项目变化。';
    return {
      source: 'fallback',
      headline:
        facts.overview.commitCount > 0 ? `共 ${facts.overview.commitCount} 次提交` : '',
      summaryParagraph:
        facts.overview.commitCount === 0 ? emptyCopy : '',
      topics: [],
      openQuestions: [],
    };
  }

  private resolveTopics(
    topics: RawBriefingAiTopic[],
    facts: BriefingFactsPayload,
  ): BriefingAiTopic[] {
    const commits = new Map(
      facts.commits.map((commit) => [`${commit.repository}:${commit.id}`, commit]),
    );
    const usedCommitKeys = new Set<string>();

    return topics.map((topic) => {
      if (topic.commitReferences.length === 0) {
        throw new Error(`Briefing topic has no commit references: ${topic.title}`);
      }

      const referencedCommits = topic.commitReferences.map((reference) => {
        const key = `${reference.repository}:${reference.commitId}`;
        const commit = commits.get(key);
        if (!commit) {
          throw new Error(
            `Briefing topic references unknown commit: ${reference.repository}:${reference.commitId}`,
          );
        }
        if (usedCommitKeys.has(key)) {
          throw new Error(`Briefing topics reuse commit: ${key}`);
        }
        usedCommitKeys.add(key);
        return commit;
      });
      const allowedModules = new Set(
        referencedCommits.flatMap((commit) =>
          commit.scope ? [commit.repository, commit.scope] : [commit.repository],
        ),
      );
      const modules = topic.modules.map((module) => module.trim()).filter(Boolean);
      const invalidModule = modules.find((module) => !allowedModules.has(module));
      if (invalidModule) {
        throw new Error(`Briefing topic references unknown module: ${invalidModule}`);
      }

      return {
        title: topic.title.trim(),
        summary: topic.summary.trim(),
        modules,
        commitReferences: referencedCommits.map((commit) => ({
          repository: commit.repository,
          commitId: commit.id,
          title: commit.message,
        })),
      };
    });
  }
}

function resolveBriefingAiTimeoutMs() {
  const configured = Number(process.env.FLOWX_BRIEFING_AI_TIMEOUT_MS?.trim());
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_BRIEFING_AI_TIMEOUT_MS;
}
