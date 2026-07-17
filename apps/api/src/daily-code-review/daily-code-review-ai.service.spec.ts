import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyCodeReviewAiService } from './daily-code-review-ai.service';

describe('DailyCodeReviewAiService', () => {
  const reviewDailyChanges = vi.fn();
  const resolveInvocationContext = vi.fn();
  const getConfiguredDefaultProvider = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FLOWX_BRIEFING_AI_DISABLED;
    delete process.env.FLOWX_BRIEFING_AI_ENABLED;
    delete process.env.FLOWX_DAILY_CODE_REVIEW_AI_PROVIDER;
    getConfiguredDefaultProvider.mockReturnValue('mock');
    resolveInvocationContext.mockResolvedValue({ provider: 'mock' });
  });

  function createService() {
    return new DailyCodeReviewAiService(
      {
        get: () => ({ reviewDailyChanges }),
      } as never,
      {
        resolveInvocationContext,
        getConfiguredDefaultProvider,
      } as never,
    );
  }

  it('recovers FAILED reasons from finding arrays when AI omits errorMessage', async () => {
    reviewDailyChanges.mockResolvedValue({
      status: 'FAILED',
      issues: ['找不到待审查的 commit diff'],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    });

    const result = await createService().reviewUnit({
      unit: {
        repositoryName: 'flowx-api',
        repositoryId: 'repo-1',
        localPath: '/tmp/flowx-api',
        ref: 'main',
        commits: [{ id: 'abc', message: 'feat' }],
        date: '2026-07-08',
        rangeLabel: '2026-07-08',
      },
      workspace: null,
    });

    expect(result).toEqual({
      status: 'FAILED',
      errorMessage: '找不到待审查的 commit diff',
      issues: [],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    });
  });
});
