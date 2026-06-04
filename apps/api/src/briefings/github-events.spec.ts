import { describe, expect, it } from 'vitest';
import { buildDedupeKey } from './briefing-events';
import { isGithubPing, normalizeGithubPayload } from './github-events';

describe('GitHub briefing events', () => {
  it('detects ping events', () => {
    expect(isGithubPing('ping')).toBe(true);
    expect(isGithubPing('push')).toBe(false);
  });

  it('normalizes push payloads', () => {
    const event = normalizeGithubPayload('push', {
      ref: 'refs/heads/main',
      after: 'abc123',
      commits: [{ id: 'abc123', message: 'feat: github webhook support', author: { name: 'Alice' } }],
      repository: {
        id: 99,
        full_name: 'rokid/flowx',
        name: 'flowx',
      },
      sender: {
        login: 'alice',
        name: 'Alice',
      },
      head_commit: {
        timestamp: '2026-06-03T09:15:00+08:00',
      },
    });

    expect(event).toMatchObject({
      provider: 'github',
      externalPath: 'rokid/flowx',
      externalId: '99',
      eventType: 'push',
      subject: 'main',
      actorUsername: 'alice',
      commits: [{ id: 'abc123', message: 'feat: github webhook support', author: 'Alice' }],
    });
  });

  it('normalizes pull request payloads as merge requests', () => {
    const event = normalizeGithubPayload('pull_request', {
      action: 'opened',
      pull_request: {
        id: 12,
        number: 4,
        title: 'Add GitHub support',
        html_url: 'https://github.com/rokid/flowx/pull/4',
        updated_at: '2026-06-03T10:00:00+08:00',
      },
      repository: {
        id: 99,
        full_name: 'rokid/flowx',
        name: 'flowx',
      },
      sender: { login: 'bob' },
    });

    expect(event).toMatchObject({
      eventType: 'merge_request',
      objectKind: 'pull_request',
      action: 'opened',
      subject: 'Add GitHub support',
    });
    expect(buildDedupeKey(event)).toContain('github:rokid/flowx:merge_request');
  });

  it('normalizes failed workflow runs as pipeline events', () => {
    const event = normalizeGithubPayload('workflow_run', {
      action: 'completed',
      workflow_run: {
        id: 501,
        head_branch: 'main',
        conclusion: 'failure',
        html_url: 'https://github.com/rokid/flowx/actions/runs/501',
        updated_at: '2026-06-03T11:00:00+08:00',
      },
      repository: {
        id: 99,
        full_name: 'rokid/flowx',
        name: 'flowx',
      },
      sender: { login: 'ci' },
    });

    expect(event).toMatchObject({
      eventType: 'pipeline',
      action: 'failure',
      summary: {
        status: 'failure',
      },
    });
  });
});
