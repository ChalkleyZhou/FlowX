import { describe, expect, it } from 'vitest';
import {
  formatDailyCodeReviewTitle,
  renderDailyCodeReviewHtml,
  renderDailyCodeReviewMarkdown,
  renderGeneratingDailyCodeReviewContent,
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

  it('renders empty Code Review scope message instead of empty-day copy', () => {
    const markdown = renderDailyCodeReviewMarkdown({
      projectName: 'FlowX',
      date: '2026-07-07',
      rangeLabel: '2026-07-07',
      overallStatus: 'SKIPPED_NO_CR_SOURCES',
      units: [],
    });
    const html = renderDailyCodeReviewHtml({
      projectName: 'FlowX',
      date: '2026-07-07',
      rangeLabel: '2026-07-07',
      overallStatus: 'SKIPPED_NO_CR_SOURCES',
      units: [],
    });

    expect(markdown).toContain('没有可审查的仓库');
    expect(markdown).toContain('默认会审查工作区全部仓库');
    expect(markdown).not.toContain('今日无代码变更');
    expect(html).toContain('没有可审查的仓库');
    expect(html).not.toContain('今日无代码变更');
  });

  it('renders generating placeholder content', () => {
    const content = renderGeneratingDailyCodeReviewContent({
      projectName: 'FlowX',
      date: '2026-07-07',
      rangeLabel: '2026-07-07',
      unitCount: 2,
    });

    expect(content.markdownContent).toContain('GENERATING');
    expect(content.markdownContent).toContain('已识别 2 个仓库/分支审查单元');
    expect(content.htmlContent).toContain('稍后会自动更新');
  });

  it('renders findings when AI returns string fields instead of arrays', () => {
    const markdown = renderDailyCodeReviewMarkdown({
      projectName: 'FlowX',
      date: '2026-07-07',
      rangeLabel: '2026-07-07',
      overallStatus: 'COMPLETED',
      units: [
        unit({
          findings: {
            issues: ['Missing validation'],
            bugs: [],
            missingTests: [],
            suggestions: 'Keep review skill instructions in repo',
            impactScope: [],
          } as never,
        }),
      ],
    });

    expect(markdown).toContain('**优化建议**');
    expect(markdown).toContain('Keep review skill instructions in repo');
  });

  it('renders object findings as readable copy instead of [object Object]', () => {
    const markdown = renderDailyCodeReviewMarkdown({
      projectName: 'FlowX',
      date: '2026-07-07',
      rangeLabel: '2026-07-07',
      overallStatus: 'COMPLETED',
      units: [
        unit({
          findings: {
            issues: [{ title: '校验缺失', description: '提交空数据未拦截' }] as never,
            bugs: [{ message: '空指针异常' }] as never,
            missingTests: [{ summary: '补充调度器集成测试' }] as never,
            suggestions: [{ title: '规范', text: '把 review skill 放进仓库' }] as never,
            impactScope: ['briefings'],
          },
        }),
      ],
    });

    expect(markdown).not.toContain('[object Object]');
    expect(markdown).toContain('校验缺失：提交空数据未拦截');
    expect(markdown).toContain('空指针异常');
    expect(markdown).toContain('补充调度器集成测试');
    expect(markdown).toContain('规范：把 review skill 放进仓库');
  });
});
