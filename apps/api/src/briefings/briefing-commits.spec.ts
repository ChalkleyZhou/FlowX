import { describe, expect, it } from 'vitest';
import {
  categorizeCommitMessage,
  collectDailyCommits,
  extractCommitsFromPush,
  isMeaningfulCommitMessage,
  summarizeDailyCommits,
} from './briefing-commits';
import type { NormalizedBriefingEvent } from './briefing-events';

function pushEvent(overrides: Partial<NormalizedBriefingEvent> = {}): NormalizedBriefingEvent {
  return {
    provider: 'gitlab',
    externalPath: 'rokid/flowx',
    externalId: '1',
    eventType: 'push',
    objectKind: 'push',
    projectName: 'flowx-api',
    action: 'push',
    subject: 'main',
    occurredAt: '2026-06-03T01:00:00.000Z',
    summary: { ref: 'main', commitCount: 2 },
    ...overrides,
  };
}

describe('briefing commits', () => {
  it('categorizes conventional commit prefixes', () => {
    expect(categorizeCommitMessage('feat(auth): add DingTalk login')).toBe('feature');
    expect(categorizeCommitMessage('fix(briefing): dedupe webhook events')).toBe('fix');
    expect(categorizeCommitMessage('chore: bump deps')).toBe('other');
  });

  it('extracts commits from raw push payload when normalized payload has none', () => {
    const commits = extractCommitsFromPush(pushEvent(), {
      commits: [
        {
          id: 'abc123',
          message: 'feat(briefing): add daily summary\n\n',
          author: { name: 'Alice' },
        },
        {
          id: 'def456',
          message: 'fix(renderer): escape html output',
          author_name: 'Bob',
        },
      ],
    });

    expect(commits).toHaveLength(2);
    expect(commits[0]?.message).toContain('feat(briefing)');
    expect(commits[1]?.author).toBe('Bob');
  });

  it('drops low-signal commit titles such as bare 翻译', () => {
    expect(isMeaningfulCommitMessage('翻译')).toBe(false);
    expect(isMeaningfulCommitMessage('销售模块子产品明细表单配置功能开发')).toBe(true);

    const summary = summarizeDailyCommits([
      {
        id: '1',
        message: '翻译',
        projectName: 'r2os',
        occurredAt: '2026-06-03T01:00:00.000Z',
      },
      {
        id: '2',
        message: '销售模块子产品明细表单配置功能开发',
        projectName: 'r2os',
        occurredAt: '2026-06-03T01:00:00.000Z',
      },
    ]);

    expect(summary.totalCommits).toBe(1);
    expect(summary.other).toHaveLength(1);
    expect(summary.other[0]?.title).toContain('销售模块');
  });

  it('dedupes commits across push events for the same day', () => {
    const summary = summarizeDailyCommits(
      collectDailyCommits([
        {
          event: pushEvent({ projectName: 'flowx-api' }),
          rawPayload: {
            commits: [{ id: 'abc', message: 'feat: first' }],
          },
        },
        {
          event: pushEvent({ projectName: 'flowx-api' }),
          rawPayload: {
            commits: [{ id: 'abc', message: 'feat: first' }, { id: 'def', message: 'fix: second' }],
          },
        },
      ]),
    );

    expect(summary.totalCommits).toBe(2);
    expect(summary.features).toHaveLength(1);
    expect(summary.fixes).toHaveLength(1);
  });
});
