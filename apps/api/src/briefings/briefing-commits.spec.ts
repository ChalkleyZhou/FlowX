import { describe, expect, it } from 'vitest';
import {
  categorizeCommitMessage,
  collectDailyCommits,
  extractCommitsFromPush,
  isMeaningfulCommitMessage,
  orderedCommitCategoryGroups,
  parseConventionalCommitType,
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
  it('parses commitlint conventional commit types', () => {
    expect(parseConventionalCommitType('feat(auth): add DingTalk login')).toBe('feat');
    expect(parseConventionalCommitType('fix(briefing): dedupe webhook events')).toBe('fix');
    expect(parseConventionalCommitType('docs(readme): update setup guide')).toBe('docs');
    expect(parseConventionalCommitType('chore: bump deps')).toBe('chore');
    expect(parseConventionalCommitType('refactor(api): split modules')).toBe('refactor');
  });

  it('categorizes conventional commit prefixes', () => {
    expect(categorizeCommitMessage('feat(auth): add DingTalk login')).toBe('feat');
    expect(categorizeCommitMessage('fix(briefing): dedupe webhook events')).toBe('fix');
    expect(categorizeCommitMessage('docs(api): document webhook setup')).toBe('docs');
    expect(categorizeCommitMessage('chore: bump deps')).toBe('chore');
    expect(categorizeCommitMessage('ci: add nightly workflow')).toBe('ci');
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

  it('keeps conventional chore and docs commits while dropping bare low-signal titles', () => {
    expect(isMeaningfulCommitMessage('chore: bump deps')).toBe(true);
    expect(isMeaningfulCommitMessage('docs: update user manual')).toBe(true);
    expect(isMeaningfulCommitMessage('chore')).toBe(false);
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
      {
        id: '3',
        message: 'docs(briefing): add commitlint categories',
        projectName: 'r2os',
        occurredAt: '2026-06-03T01:00:00.000Z',
      },
      {
        id: '4',
        message: 'chore(deps): upgrade vitest',
        projectName: 'r2os',
        occurredAt: '2026-06-03T01:00:00.000Z',
      },
    ]);

    expect(summary.totalCommits).toBe(3);
    expect(summary.byCategory.other).toHaveLength(1);
    expect(summary.byCategory.other[0]?.title).toContain('销售模块');
    expect(summary.byCategory.docs).toHaveLength(1);
    expect(summary.byCategory.chore).toHaveLength(1);
  });

  it('groups commits by commitlint category', () => {
    const summary = summarizeDailyCommits(
      collectDailyCommits([
        {
          event: pushEvent({ projectName: 'flowx-api' }),
          rawPayload: {
            commits: [
              { id: 'abc', message: 'feat: first' },
              { id: 'def', message: 'fix: second' },
              { id: 'ghi', message: 'docs: third' },
            ],
          },
        },
      ]),
    );

    const groups = orderedCommitCategoryGroups(summary);
    expect(groups.map((group) => group.category)).toEqual(['feat', 'fix', 'docs']);
    expect(summary.totalCommits).toBe(3);
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
    expect(summary.byCategory.feat).toHaveLength(1);
    expect(summary.byCategory.fix).toHaveLength(1);
  });

  it('carries repositoryId from briefing events onto commits', () => {
    const commits = collectDailyCommits([
      {
        event: pushEvent({ projectName: 'r2crm' }),
        rawPayload: {
          commits: [{ id: 'abc', message: 'feat: first' }],
        },
        repositoryId: 'repo-r2',
      },
    ]);

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      id: 'abc',
      projectName: 'r2crm',
      repositoryId: 'repo-r2',
    });
  });

  it('dedupes by repositoryId when projectName differs across events', () => {
    const commits = collectDailyCommits([
      {
        event: pushEvent({ projectName: 'r2crm' }),
        rawPayload: {
          commits: [{ id: 'abc', message: 'feat: first' }],
        },
        repositoryId: 'repo-r2',
      },
      {
        event: pushEvent({ projectName: 'R2CRM' }),
        rawPayload: {
          commits: [{ id: 'abc', message: 'feat: first' }],
        },
        repositoryId: 'repo-r2',
      },
    ]);

    expect(commits).toHaveLength(1);
    expect(commits[0]?.repositoryId).toBe('repo-r2');
  });
});
