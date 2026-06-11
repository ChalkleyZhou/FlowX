import { describe, expect, it } from 'vitest';
import type { NormalizedBriefingEvent } from './briefing-events';
import { aggregateEvents, renderBriefingHtml, renderBriefingMarkdown } from './briefing-renderer';

function event(overrides: Partial<NormalizedBriefingEvent>): NormalizedBriefingEvent {
  return {
    provider: 'gitlab',
    externalPath: 'rokid/flowx',
    externalId: '1',
    eventType: 'push',
    objectKind: 'push',
    projectName: 'flowx',
    action: 'push',
    subject: 'main',
    occurredAt: '2026-06-03T01:00:00.000Z',
    summary: {},
    ...overrides,
  };
}

describe('briefing renderer', () => {
  it('aggregates overview counts by type and project', () => {
    const aggregate = aggregateEvents([
      event({ externalPath: 'rokid/a', externalId: '1' }),
      event({
        eventType: 'merge_request',
        objectKind: 'merge_request',
        externalPath: 'rokid/a',
        externalId: '1',
      }),
      event({ eventType: 'issue', objectKind: 'issue', externalPath: 'rokid/b', externalId: '2' }),
      event({
        eventType: 'pipeline',
        objectKind: 'pipeline',
        externalPath: 'github.com/org/api',
        provider: 'github',
        externalId: '9',
        summary: { status: 'failed' },
      }),
    ]);

    expect(aggregate.overview).toEqual({
      projectCount: 3,
      eventCount: 4,
      mergeRequestCount: 1,
      issueCount: 1,
      failedPipelineCount: 1,
    });
  });

  it('renders project change topics before the development record', () => {
    const markdown = renderBriefingMarkdown({
      date: '2026-06-03',
      projectName: 'FlowX',
      events: [
        event({
          commits: [
            { id: 'abc', message: 'feat(briefing): add daily summary' },
            { id: 'def', message: 'fix(renderer): escape html output' },
          ],
          summary: { ref: 'main', commitCount: 2 },
        }),
      ],
      aiSummary: {
        source: 'ai',
        aiProvider: 'codex',
        headline: '简报内容组织发生调整',
        summaryParagraph: '当天提交主要调整了简报内容组织。',
        topics: [
          {
            title: '简报内容组织调整',
            summary: '简报从提交分类调整为项目变化主题。',
            modules: ['briefing'],
            commitReferences: [
              {
                repository: 'flowx',
                commitId: 'abc',
                title: 'feat(briefing): add daily summary',
              },
            ],
          },
        ],
        openQuestions: ['commit 未说明历史简报是否同步调整。'],
      },
    });

    expect(markdown).toContain('# FlowX · 项目变化简报 · 2026-06-03');
    expect(markdown).toContain('## 今日概览');
    expect(markdown).toContain('简报内容组织发生调整');
    expect(markdown).toContain('## 主要变化');
    expect(markdown).toContain('### 简报内容组织调整');
    expect(markdown).toContain('简报从提交分类调整为项目变化主题。');
    expect(markdown).toContain('涉及模块：briefing');
    expect(markdown).toContain('依据：feat(briefing): add daily summary [flowx]');
    expect(markdown).toContain('## 待确认事项');
    expect(markdown).toContain('commit 未说明历史简报是否同步调整。');
    expect(markdown).toContain('## 研发记录');
    expect(markdown).toContain('### 新功能');
    expect(markdown).toContain('feat(briefing): add daily summary');
    expect(markdown).toContain('### 问题修复');
    expect(markdown).toContain('fix(renderer): escape html output');
  });

  it('renders commitlint category sections for docs and chore commits', () => {
    const markdown = renderBriefingMarkdown({
      date: '2026-06-03',
      projectName: 'FlowX',
      events: [
        event({
          commits: [
            { id: 'a1', message: 'docs(readme): update setup guide' },
            { id: 'a2', message: 'chore(deps): bump vitest' },
          ],
          summary: { ref: 'main', commitCount: 2 },
        }),
      ],
    });

    expect(markdown).toContain('### 文档');
    expect(markdown).toContain('docs(readme): update setup guide');
    expect(markdown).toContain('### 杂项维护');
    expect(markdown).toContain('chore(deps): bump vitest');
    expect(markdown).toContain('## 今日概览');
    expect(markdown).not.toContain('## 主要变化');
    expect(markdown).not.toContain('## 待确认事项');
    expect(markdown).toContain('## 研发记录');
  });

  it('escapes HTML content from commit messages', () => {
    const html = renderBriefingHtml({
      date: '2026-06-03',
      projectName: 'FlowX',
      events: [
        event({
          projectName: 'flowx & api',
          commits: [{ id: 'x1', message: '<script>alert("x")</script>' }],
        }),
      ],
    });

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('flowx &amp; api');
    expect(html).not.toContain('<script>alert("x")</script>');
  });
});
