import { describe, expect, it } from 'vitest';
import {
  formatDailyCodeReviewTitle,
  renderDailyCodeReviewMarkdown,
} from './daily-code-review-renderer';
import type { DailyCodeReviewUnitResult } from './daily-code-review.types';

const unit = (overrides: Partial<DailyCodeReviewUnitResult>): DailyCodeReviewUnitResult => ({
  repositoryName: 'flowx-api',
  repositoryId: 'repo-1',
  ref: 'main',
  commits: [{ id: 'abc123def456', message: 'feat: add review', author: 'dev' }],
  status: 'COMPLETED',
  findings: {
    issues: ['Missing edge-case handling'],
    bugs: [],
    missingTests: ['Add scheduler spec'],
    suggestions: ['Keep skill instructions in repo'],
    impactScope: ['briefings'],
  },
  ...overrides,
});

describe('daily-code-review-renderer', () => {
  it('formats review title', () => {
    expect(formatDailyCodeReviewTitle('FlowX', '2026-07-07')).toBe(
      'FlowX · 每日 Code Review · 2026-07-07',
    );
  });

  it('renders markdown with per-branch sections', () => {
    const markdown = renderDailyCodeReviewMarkdown({
      projectName: 'FlowX',
      date: '2026-07-07',
      rangeLabel: '2026-07-07',
      overallStatus: 'COMPLETED',
      units: [
        unit({}),
        unit({
          repositoryName: 'flowx-api',
          ref: 'feature/login',
          status: 'SKIPPED_NO_SKILL',
          skillHint: '请在仓库添加 `.cursor/skills/code-review/SKILL.md`。',
          findings: undefined,
        }),
      ],
    });

    expect(markdown).toContain('# FlowX · 每日 Code Review · 2026-07-07');
    expect(markdown).toContain('## flowx-api / main');
    expect(markdown).toContain('## flowx-api / feature/login');
    expect(markdown).toContain('未配置 review skill');
    expect(markdown).toContain('Missing edge-case handling');
  });

  it('renders empty-day message', () => {
    const markdown = renderDailyCodeReviewMarkdown({
      projectName: 'FlowX',
      date: '2026-07-07',
      rangeLabel: '2026-07-07',
      overallStatus: 'SKIPPED_NO_CHANGES',
      units: [],
    });

    expect(markdown).toContain('今日无代码变更，跳过审查。');
  });
});
