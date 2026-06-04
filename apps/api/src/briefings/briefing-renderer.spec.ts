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

  it('renders commit summary and categorized sections', () => {
    const markdown = renderBriefingMarkdown({
      date: '2026-06-03',
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

    expect(markdown).toContain('# 研发日报 - 2026-06-03');
    expect(markdown).toContain('## 提交明细（按 message 归类）');
    expect(markdown).toContain('### 新功能 / 能力');
    expect(markdown).toContain('feat(briefing): add daily summary');
    expect(markdown).toContain('### 问题修复');
    expect(markdown).toContain('fix(renderer): escape html output');
    expect(markdown).toContain('### 已合并合并请求');
    expect(markdown).toContain('- merge: Add briefing page（flowx-web）');
    expect(markdown).toContain('- 本日无相关记录。');
  });

  it('escapes HTML content from GitLab payload fields', () => {
    const html = renderBriefingHtml({
      date: '2026-06-03',
      events: [
        event({
          subject: '<script>alert("x")</script>',
          projectName: 'flowx & api',
        }),
      ],
    });

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('flowx &amp; api');
    expect(html).not.toContain('<script>alert("x")</script>');
  });
});
