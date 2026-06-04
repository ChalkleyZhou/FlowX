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
      detail: '来自提交说明的自动归类（未启用 AI 或 AI 调用失败）。',
      repositories: [item.projectName],
    }));
    const fixes: BriefingAiWorkItem[] = categorized.fixes.map((item) => ({
      title: item.title,
      detail: '来自提交说明的自动归类（未启用 AI 或 AI 调用失败）。',
      repositories: [item.projectName],
    }));
    const otherNotes = categorized.other.map((item) => `[${item.projectName}] ${item.title}`);

    for (const mr of facts.mergeRequests.filter(
      (item) => item.action === 'merge' || item.state === 'merged',
    )) {
      features.push({
        title: mr.title,
        detail: `已合并合并请求（${mr.action ?? 'merge'}）。`,
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

    const headline =
      facts.overview.commitCount > 0
        ? `${facts.date} 共 ${facts.overview.commitCount} 次提交，覆盖 ${facts.overview.repositoryCount} 个仓库`
        : `${facts.date} 研发活动较少，以合并请求与其它事件为主`;

    const summaryParagraph =
      facts.overview.eventCount === 0
        ? '本日未收到可汇总的 webhook 事件，请检查简报数据源与仓库推送配置。'
        : `本日收到 ${facts.overview.eventCount} 条研发事件。当前为规则归纳摘要；配置 AI_EXECUTOR_PROVIDER（codex/cursor）及对应凭据后可启用 AI 总结。`;

    return {
      source: 'fallback',
      headline,
      summaryParagraph,
      features,
      fixes,
      risks,
      otherNotes,
    };
  }
}
