import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_EXECUTOR_REGISTRY,
  type AIExecutorProvider,
  type AIExecutorRegistry,
} from '../ai/ai-executor';
import { AiInvocationContextService } from '../ai/ai-invocation-context.service';
import type { AiInvocationRecipient } from '../ai/ai-invocation-context.service';
import type {
  DailyCodeReviewUnitInput,
  DailyCodeReviewUnitOutput,
  ReviewCodeOutput,
  WorkspaceContext,
} from '../common/types';

const DEFAULT_DAILY_CODE_REVIEW_TIMEOUT_MS = 300_000;

@Injectable()
export class DailyCodeReviewAiService {
  private readonly logger = new Logger(DailyCodeReviewAiService.name);

  constructor(
    @Inject(AI_EXECUTOR_REGISTRY)
    private readonly executorRegistry: AIExecutorRegistry,
    private readonly aiInvocationContextService: AiInvocationContextService,
  ) {}

  async reviewUnit(input: {
    unit: DailyCodeReviewUnitInput;
    workspace: WorkspaceContext | null;
    recipient?: AiInvocationRecipient | null;
  }): Promise<DailyCodeReviewUnitOutput> {
    if (!this.isAiEnabled()) {
      return this.buildSkippedNoSkillOutput(
        '每日 Code Review 已禁用。请检查 FLOWX_BRIEFING_AI_DISABLED / FLOWX_BRIEFING_AI_ENABLED 配置。',
      );
    }

    try {
      const provider = this.resolveProvider();
      const context = await this.aiInvocationContextService.resolveInvocationContext(
        provider,
        input.recipient ?? null,
      );
      const executor = this.executorRegistry.get(provider);
      const timeoutMs =
        Number(process.env.DAILY_CODE_REVIEW_TIMEOUT_MS?.trim()) ||
        DEFAULT_DAILY_CODE_REVIEW_TIMEOUT_MS;

      const result = await Promise.race([
        executor.reviewDailyChanges(
          {
            unit: input.unit,
            workspace: input.workspace,
          },
          context,
        ),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Daily code review timed out.')), timeoutMs);
        }),
      ]);

      return this.normalizeOutput(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Daily code review AI failed: ${message}`);
      return {
        status: 'FAILED',
        errorMessage: message,
        issues: [],
        bugs: [],
        missingTests: [],
        suggestions: [],
        impactScope: [],
      };
    }
  }

  private normalizeOutput(output: DailyCodeReviewUnitOutput): DailyCodeReviewUnitOutput {
    if (output.status === 'SKIPPED_NO_SKILL') {
      return {
        ...this.emptyFindings(),
        status: 'SKIPPED_NO_SKILL',
        skillHint:
          output.skillHint?.trim() ||
          '未找到 review skill。请在仓库中添加，例如 `.cursor/skills/code-review/SKILL.md`。',
      };
    }

    if (output.status === 'SKIPPED_NO_CHANGES') {
      return {
        ...this.emptyFindings(),
        status: 'SKIPPED_NO_CHANGES',
      };
    }

    if (output.status === 'FAILED') {
      return {
        ...this.emptyFindings(),
        status: 'FAILED',
        errorMessage: output.errorMessage?.trim() || 'Daily code review failed.',
      };
    }

    return {
      status: 'COMPLETED',
      issues: output.issues ?? [],
      bugs: output.bugs ?? [],
      missingTests: output.missingTests ?? [],
      suggestions: output.suggestions ?? [],
      impactScope: output.impactScope ?? [],
    };
  }

  private buildSkippedNoSkillOutput(skillHint: string): DailyCodeReviewUnitOutput {
    return {
      ...this.emptyFindings(),
      status: 'SKIPPED_NO_SKILL',
      skillHint,
    };
  }

  private emptyFindings(): ReviewCodeOutput {
    return {
      issues: [],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    };
  }

  private isAiEnabled() {
    if (process.env.FLOWX_BRIEFING_AI_DISABLED === 'true') {
      return false;
    }
    return process.env.FLOWX_BRIEFING_AI_ENABLED !== 'false';
  }

  private resolveProvider(): AIExecutorProvider {
    const override = process.env.FLOWX_DAILY_CODE_REVIEW_AI_PROVIDER?.trim().toLowerCase();
    if (override === 'cursor' || override === 'codex') {
      return override;
    }
    return this.aiInvocationContextService.getConfiguredDefaultProvider();
  }
}
