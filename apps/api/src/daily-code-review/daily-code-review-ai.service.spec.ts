import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DailyCodeReviewAiService } from './daily-code-review-ai.service';

describe('DailyCodeReviewAiService', () => {
  const reviewDailyChanges = vi.fn();
  const resolveInvocationContext = vi.fn();
  const getConfiguredDefaultProvider = vi.fn();
  let repoWithSkill: string;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FLOWX_BRIEFING_AI_DISABLED;
    delete process.env.FLOWX_BRIEFING_AI_ENABLED;
    delete process.env.FLOWX_DAILY_CODE_REVIEW_AI_PROVIDER;
    getConfiguredDefaultProvider.mockReturnValue('mock');
    resolveInvocationContext.mockResolvedValue({ provider: 'mock' });

    repoWithSkill = mkdtempSync(join(tmpdir(), 'flowx-daily-cr-ai-'));
    const skillDir = join(repoWithSkill, '.cursor/skills/code-review');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: code-review\ndescription: Review code changes for bugs and missing tests\n---\n\n# Code Review\n',
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(repoWithSkill, { recursive: true, force: true });
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
        localPath: repoWithSkill,
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

  it('returns SKIPPED_NO_SKILL and never calls the executor when no review skill exists on disk', async () => {
    const repoWithoutSkill = mkdtempSync(join(tmpdir(), 'flowx-daily-cr-ai-no-skill-'));

    try {
      const result = await createService().reviewUnit({
        unit: {
          repositoryName: 'flowx-api',
          repositoryId: 'repo-1',
          localPath: repoWithoutSkill,
          ref: 'main',
          commits: [{ id: 'abc', message: 'feat' }],
          date: '2026-07-08',
          rangeLabel: '2026-07-08',
        },
        workspace: null,
      });

      expect(reviewDailyChanges).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'SKIPPED_NO_SKILL',
        skillHint: '未找到 review skill。请在仓库中添加，例如 `.cursor/skills/code-review/SKILL.md`。',
        issues: [],
        bugs: [],
        missingTests: [],
        suggestions: [],
        impactScope: [],
      });
    } finally {
      rmSync(repoWithoutSkill, { recursive: true, force: true });
    }
  });

  it('returns SKIPPED_NO_SKILL and never calls the executor when localPath is missing', async () => {
    const result = await createService().reviewUnit({
      unit: {
        repositoryName: 'flowx-api',
        repositoryId: 'repo-1',
        localPath: null,
        ref: 'main',
        commits: [{ id: 'abc', message: 'feat' }],
        date: '2026-07-08',
        rangeLabel: '2026-07-08',
      },
      workspace: null,
    });

    expect(reviewDailyChanges).not.toHaveBeenCalled();
    expect(result.status).toBe('SKIPPED_NO_SKILL');
  });

  it('passes the discovered skill relativePath and content into the unit sent to the executor', async () => {
    reviewDailyChanges.mockResolvedValue({
      status: 'COMPLETED',
      issues: [],
      bugs: [],
      missingTests: [],
      suggestions: [],
      impactScope: [],
    });

    await createService().reviewUnit({
      unit: {
        repositoryName: 'flowx-api',
        repositoryId: 'repo-1',
        localPath: repoWithSkill,
        ref: 'main',
        commits: [{ id: 'abc', message: 'feat' }],
        date: '2026-07-08',
        rangeLabel: '2026-07-08',
      },
      workspace: null,
    });

    expect(reviewDailyChanges).toHaveBeenCalledTimes(1);
    const [callInput] = reviewDailyChanges.mock.calls[0];
    expect(callInput.unit.discoveredSkill).toEqual({
      relativePath: '.cursor/skills/code-review/SKILL.md',
      content: expect.stringContaining('Review code changes for bugs and missing tests'),
    });
  });
});
