import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_EXECUTOR_REGISTRY,
  type AIExecutorProvider,
  type AIExecutorRegistry,
} from '../ai/ai-executor';
import { AiInvocationContextService } from '../ai/ai-invocation-context.service';
import { CodexAiExecutor } from '../ai/codex-ai.executor';
import { buildBriefingSummaryPrompt } from '../prompts/briefing-summary.prompt';
import { buildBriefingFacts, type BriefingFactsPayload } from './briefing-facts';
import { summarizeDailyCommits, collectDailyCommits } from './briefing-commits';
import type { NormalizedBriefingEvent } from './briefing-events';

export interface BriefingAiWorkItem {
  title: string;
  detail: string;
  repositories: string[];
}

export interface BriefingAiSummary {
  source: 'ai' | 'fallback';
  aiProvider?: AIExecutorProvider;
  headline: string;
  summaryParagraph: string;
  features: BriefingAiWorkItem[];
  fixes: BriefingAiWorkItem[];
  others: BriefingAiWorkItem[];
  risks: string[];
  otherNotes: string[];
}

interface SummarizeInput {
  date: string;
  projectName: string;
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
    if (!this.isAiEnabled()) {
      return this.buildFallbackSummary(facts, input);
    }

    try {
      const provider = this.resolveProvider();
      const context = await this.aiInvocationContextService.resolveInvocationContext(provider, null);
      const executor = this.resolveStructuredExecutor(provider);
      const prompt = buildBriefingSummaryPrompt(facts);
      const raw = await executor.runStructuredJsonStage<{
        headline: string;
        summaryParagraph: string;
        features: BriefingAiWorkItem[];
        fixes: BriefingAiWorkItem[];
        risks: string[];
        otherNotes: string[];
      }>(
        'briefing-summary.output.schema.json',
        prompt,
        'briefing summary',
        context,
      );

      return {
        source: 'ai',
        aiProvider: provider,
        headline: raw.headline.trim(),
        summaryParagraph: raw.summaryParagraph.trim(),
        features: raw.features ?? [],
        fixes: raw.fixes ?? [],
        others: [],
        risks: raw.risks ?? [],
        otherNotes: raw.otherNotes ?? [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Briefing AI summary failed, using fallback: ${message}`);
      return this.buildFallbackSummary(facts, input);
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

  private buildFallbackSummary(
    facts: BriefingFactsPayload,
    input: SummarizeInput,
  ): BriefingAiSummary {
    const eventInputs = input.events.map((event, index) => ({
      event,
      rawPayload: input.rawPayloadByEventIndex?.[index],
    }));
    const categorized = summarizeDailyCommits(collectDailyCommits(eventInputs));

    const features: BriefingAiWorkItem[] = categorized.features.map((item) => ({
      title: item.title,
      detail: '',
      repositories: [item.projectName],
    }));
    const fixes: BriefingAiWorkItem[] = categorized.fixes.map((item) => ({
      title: item.title,
      detail: '',
      repositories: [item.projectName],
    }));
    const others: BriefingAiWorkItem[] = categorized.other.map((item) => ({
      title: item.title,
      detail: '',
      repositories: [item.projectName],
    }));

    for (const mr of facts.mergeRequests.filter(
      (item) => item.action === 'merge' || item.state === 'merged',
    )) {
      features.push({
        title: mr.title,
        detail: '',
        repositories: [mr.repository],
      });
    }

    const risks: string[] = [];
    for (const pipeline of facts.pipelines) {
      if (pipeline.status === 'failed' || pipeline.action === 'failed' || pipeline.action === 'failure') {
        risks.push(
          `[${pipeline.repository}] 流水线失败：${pipeline.ref ?? 'unknown'} (${pipeline.status ?? pipeline.action})`,
        );
      }
    }

    const hasWork =
      features.length > 0 || fixes.length > 0 || others.length > 0 || risks.length > 0;

    return {
      source: 'fallback',
      headline:
        facts.overview.commitCount > 0 ? `共 ${facts.overview.commitCount} 次提交` : '',
      summaryParagraph:
        facts.overview.eventCount === 0
          ? '本日暂无研发活动记录。'
          : !hasWork && facts.overview.commitCount === 0
            ? '本日有研发事件，但未解析到可归纳的提交说明。'
            : '',
      features,
      fixes,
      others,
      risks,
      otherNotes: [],
    };
  }
}
