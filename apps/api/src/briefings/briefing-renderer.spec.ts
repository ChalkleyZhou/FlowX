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

  it('renders a concise summary and omits empty sections', () => {
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
        event({
          eventType: 'merge_request',
          objectKind: 'merge_request',
          action: 'merge',
          subject: 'Add briefing page',
          projectName: 'flowx-web',
          summary: { state: 'merged' },
        }),
      ],
    });

    expect(markdown).toContain('# FlowX · 研发日报 · 2026-06-03');
    expect(markdown).toContain('## 今日研发摘要');
    expect(markdown).toContain('共 2 次提交');
    expect(markdown).toContain('### 新功能');
    expect(markdown).toContain('feat(briefing): add daily summary');
    expect(markdown).toContain('### 问题修复');
    expect(markdown).toContain('fix(renderer): escape html output');
    expect(markdown).toContain('Add briefing page');
    expect(markdown).not.toContain('本日无相关记录');
    expect(markdown).not.toContain('活动概览');
    expect(markdown).not.toContain('代码推送');
    expect(markdown).not.toContain('AI_EXECUTOR_PROVIDER');
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
