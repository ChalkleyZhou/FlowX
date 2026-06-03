import { describe, expect, it } from 'vitest';
import { buildDedupeKey, normalizeGitlabPayload } from './gitlab-events';

describe('GitLab briefing events', () => {
  it('normalizes push payloads into briefing-ready events', () => {
    const event = normalizeGitlabPayload({
      object_kind: 'push',
      event_time: '2026-06-03T09:15:00+08:00',
      user_name: 'Alice',
      user_username: 'alice',
      ref: 'refs/heads/main',
      after: 'abc123',
      commits: [{ id: 'abc123' }, { id: 'def456' }],
      project: {
        id: 42,
        name: 'daily-briefing',
      },
    });

    expect(event).toMatchObject({
      eventType: 'push',
      objectKind: 'push',
      gitlabProjectId: 42,
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
    });
    expect(event.occurredAt).toBe('2026-06-03T01:15:00.000Z');
  });

  it('normalizes merge request payloads with action and URL', () => {
    const event = normalizeGitlabPayload({
      object_kind: 'merge_request',
      user: { name: 'Bob', username: 'bob' },
      project: { id: 7, name: 'flowx-web' },
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
      objectKind: 'merge_request',
      gitlabProjectId: 7,
      projectName: 'flowx-web',
      actorName: 'Bob',
      actorUsername: 'bob',
      action: 'merge',
      subject: 'Add briefing page',
      url: 'https://gitlab.example.com/flowx/web/-/merge_requests/12',
      summary: {
        id: 99,
        iid: 12,
        state: 'merged',
        action: 'merge',
      },
    });
  });

  it('normalizes pipeline payloads using status as action', () => {
    const event = normalizeGitlabPayload({
      object_kind: 'pipeline',
      user: { name: 'CI', username: 'ci' },
      project: { id: 11, name: 'api' },
      object_attributes: {
        id: 1234,
        ref: 'release/2026-06-03',
        status: 'failed',
        url: 'https://gitlab.example.com/api/-/pipelines/1234',
        updated_at: '2026-06-03T11:00:00+08:00',
      },
    });

    expect(event).toMatchObject({
      eventType: 'pipeline',
      action: 'failed',
      subject: 'release/2026-06-03',
      summary: {
        id: 1234,
        ref: 'release/2026-06-03',
        status: 'failed',
      },
    });
  });

  it('builds stable dedupe keys from event identity fields', () => {
    const event = normalizeGitlabPayload({
      object_kind: 'issue',
      project: { id: 42, name: 'daily-briefing' },
      object_attributes: {
        id: 500,
        iid: 8,
        action: 'open',
        title: 'Webhook failed',
        updated_at: '2026-06-03T12:00:00+08:00',
      },
    });

    expect(buildDedupeKey(event)).toBe(
      'issue:42:Webhook failed:500:2026-06-03T04:00:00.000Z',
    );
  });
});
