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
import {
  normalizeReviewFindings,
  resolveFailedReviewErrorMessage,
} from './daily-code-review.types';
import { findReviewSkill } from './review-skill-discovery';

const DEFAULT_SKILL_HINT =
  '未找到 review skill。请在仓库中添加，例如 `.cursor/skills/code-review/SKILL.md`。';

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
        '每日代码审查已禁用。请检查 FLOWX_CODE_REVIEW_AI_DISABLED / FLOWX_CODE_REVIEW_AI_ENABLED 配置。',
      );
    }

    try {
      const skill = this.discoverSkill(input.unit.localPath);
      if (!skill) {
        return this.buildSkippedNoSkillOutput(DEFAULT_SKILL_HINT);
      }

      const provider = this.resolveProvider();
      const context = await this.aiInvocationContextService.resolveInvocationContext(
        provider,
        input.recipient ?? null,
      );
      const executor = this.executorRegistry.get(provider);

      const result = await executor.reviewDailyChanges(
        {
          unit: {
            ...input.unit,
            discoveredSkill: { relativePath: skill.relativePath, content: skill.content },
          },
          workspace: input.workspace,
        },
        context,
      );

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

  private discoverSkill(localPath: string | null) {
    if (!localPath) {
      return null;
    }
    return findReviewSkill(localPath);
  }

  private normalizeOutput(output: DailyCodeReviewUnitOutput): DailyCodeReviewUnitOutput {
    if (output.status === 'SKIPPED_NO_SKILL') {
      return {
        ...this.emptyFindings(),
        status: 'SKIPPED_NO_SKILL',
        skillHint: output.skillHint?.trim() || DEFAULT_SKILL_HINT,
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
        errorMessage: resolveFailedReviewErrorMessage(output),
      };
    }

    return {
      status: 'COMPLETED',
      ...normalizeReviewFindings(output),
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
    return normalizeReviewFindings(null);
  }

  private isAiEnabled() {
    // Prefer FLOWX_CODE_REVIEW_AI_*; fall back to the legacy FLOWX_BRIEFING_AI_*
    // names for one release so existing deployments keep working unchanged.
    const disabled = process.env.FLOWX_CODE_REVIEW_AI_DISABLED ?? process.env.FLOWX_BRIEFING_AI_DISABLED;
    if (disabled === 'true') {
      return false;
    }
    const enabled = process.env.FLOWX_CODE_REVIEW_AI_ENABLED ?? process.env.FLOWX_BRIEFING_AI_ENABLED;
    return enabled !== 'false';
  }

  private resolveProvider(): AIExecutorProvider {
    const override = process.env.FLOWX_DAILY_CODE_REVIEW_AI_PROVIDER?.trim().toLowerCase();
    if (override === 'cursor' || override === 'codex') {
      return override;
    }
    return this.aiInvocationContextService.getConfiguredDefaultProvider();
  }
}
