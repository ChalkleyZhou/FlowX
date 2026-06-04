import { describe, expect, it } from 'vitest';
import { buildDedupeKey } from './briefing-events';
import { normalizeGitlabPayload } from './gitlab-events';

describe('GitLab briefing events', () => {
  it('normalizes push payloads into briefing-ready events', () => {
    const event = normalizeGitlabPayload({
      object_kind: 'push',
      event_time: '2026-06-03T09:15:00+08:00',
      user_name: 'Alice',
      user_username: 'alice',
      ref: 'refs/heads/main',
      after: 'abc123',
      commits: [
        { id: 'abc123', message: 'feat: first change', author: { name: 'Alice' } },
        { id: 'def456', message: 'fix: second change', author_name: 'Alice' },
      ],
      project: {
        id: 42,
        name: 'daily-briefing',
        path_with_namespace: 'rokid/daily-briefing',
      },
    });

    expect(event).toMatchObject({
      provider: 'gitlab',
      externalPath: 'rokid/daily-briefing',
      externalId: '42',
      eventType: 'push',
      objectKind: 'push',
      projectName: 'daily-briefing',
      actorName: 'Alice',
      actorUsername: 'alice',
      action: 'push',
      subject: 'main',
      summary: {
        ref: 'main',
        after: 'abc123',
        commitCount: 2,
      },
      commits: [
        { id: 'abc123', message: 'feat: first change', author: 'Alice' },
        { id: 'def456', message: 'fix: second change', author: 'Alice' },
      ],
    });
    expect(event.occurredAt).toBe('2026-06-03T01:15:00.000Z');
  });

  it('normalizes merge request payloads with action and URL', () => {
    const event = normalizeGitlabPayload({
      object_kind: 'merge_request',
      user: { name: 'Bob', username: 'bob' },
      project: { id: 7, name: 'flowx-web', path_with_namespace: 'rokid/flowx-web' },
      object_attributes: {
        id: 99,
        iid: 12,
        action: 'merge',
        state: 'merged',
        title: 'Add briefing page',
        url: 'https://gitlab.example.com/flowx/web/-/merge_requests/12',
        updated_at: '2026-06-03T10:00:00+08:00',
      },
    });

    expect(event).toMatchObject({
      eventType: 'merge_request',
      externalId: '7',
      actorName: 'Bob',
      action: 'merge',
      subject: 'Add briefing page',
    });
  });

  it('builds stable dedupe keys from event identity fields', () => {
    const event = normalizeGitlabPayload({
      object_kind: 'issue',
      project: { id: 42, name: 'daily-briefing', path_with_namespace: 'rokid/daily-briefing' },
      object_attributes: {
        id: 500,
        iid: 8,
        action: 'open',
        title: 'Webhook failed',
        updated_at: '2026-06-03T12:00:00+08:00',
      },
    });

    expect(buildDedupeKey(event)).toBe(
      'gitlab:rokid/daily-briefing:issue:Webhook failed:500:2026-06-03T04:00:00.000Z',
    );
  });
});
