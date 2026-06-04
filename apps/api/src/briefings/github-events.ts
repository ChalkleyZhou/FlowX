import type {
  BriefingEventType,
  NormalizedBriefingCommit,
  NormalizedBriefingEvent,
} from './briefing-events';

type GithubPayload = Record<string, unknown>;
type GithubObject = Record<string, unknown>;

function asObject(value: unknown): GithubObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as GithubObject)
    : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function parsePushCommits(payload: GithubPayload) {
  const commits = payload.commits;
  if (!Array.isArray(commits)) {
    return undefined;
  }

  const parsed: NormalizedBriefingCommit[] = [];
  for (const entry of commits) {
    const commit = asObject(entry);
    const id = asString(commit.id) || asString(commit.sha);
    const message = asString(commit.message);
    if (!id || !message) {
      continue;
    }
    const author =
      asString(asObject(commit.author).name) ||
      asString(asObject(commit.committer).name) ||
      undefined;
    const normalized: NormalizedBriefingCommit = { id, message };
    if (author) {
      normalized.author = author;
    }
    parsed.push(normalized);
  }

  return parsed.length > 0 ? parsed : undefined;
}

function payloadRepository(payload: GithubPayload) {
  return asObject(payload.repository);
}

function payloadSender(payload: GithubPayload) {
  const sender = asObject(payload.sender);
  return {
    actorName: asString(sender.name) || undefined,
    actorUsername: asString(sender.login) || undefined,
  };
}

function payloadOccurredAt(payload: GithubPayload, fallback?: string) {
  return new Date(
    fallback ||
      asString(payload.created_at) ||
      asString(asObject(payload.head_commit).timestamp) ||
      new Date().toISOString(),
  ).toISOString();
}

function eventTypeFromGithubEvent(eventName: string): BriefingEventType {
  if (eventName === 'push') {
    return 'push';
  }
  if (eventName === 'create') {
    return 'tag';
  }
  if (eventName === 'pull_request') {
    return 'merge_request';
  }
  if (eventName === 'issues') {
    return 'issue';
  }
  if (eventName === 'issue_comment' || eventName === 'pull_request_review_comment') {
    return 'note';
  }
  if (eventName === 'workflow_run' || eventName === 'workflow_job') {
    return 'pipeline';
  }
  if (eventName === 'release') {
    return 'release';
  }
  return 'unsupported';
}

export function normalizeGithubPayload(
  eventName: string,
  payload: GithubPayload,
): NormalizedBriefingEvent {
  const repo = payloadRepository(payload);
  const externalPath = asString(repo.full_name);
  const externalId = String(repo.id ?? '');
  const projectName = asString(repo.name) || externalPath.split('/').pop() || externalPath;
  const eventType = eventTypeFromGithubEvent(eventName);
  const objectKind = eventName || 'unsupported';
  const base = {
    provider: 'github' as const,
    externalPath,
    externalId,
    eventType,
    objectKind,
    projectName,
    ...payloadSender(payload),
  };

  if (eventName === 'push') {
    const ref = asString(payload.ref).replace(/^refs\/(heads|tags)\//, '');
    const head = asString(asObject(payload.head_commit).id) || asString(payload.after);
    const commits = parsePushCommits(payload);
    return {
      ...base,
      action: 'push',
      subject: ref,
      occurredAt: payloadOccurredAt(payload),
      commits,
      summary: {
        ref,
        after: head || null,
        commitCount: commits?.length ?? (Array.isArray(payload.commits) ? payload.commits.length : 0),
      },
    };
  }

  if (eventName === 'create') {
    const ref = asString(payload.ref).replace(/^refs\/tags\//, '');
    return {
      ...base,
      action: 'tag_push',
      subject: ref,
      occurredAt: payloadOccurredAt(payload),
      summary: {
        ref,
        refType: asString(payload.ref_type) || null,
      },
    };
  }

  if (eventName === 'pull_request') {
    const pullRequest = asObject(payload.pull_request);
    return {
      ...base,
      action: asString(payload.action) || undefined,
      subject: asString(pullRequest.title) || 'pull_request',
      url: asString(pullRequest.html_url) || undefined,
      occurredAt: payloadOccurredAt(payload, asString(pullRequest.updated_at)),
      summary: {
        id: typeof pullRequest.id === 'number' ? pullRequest.id : null,
        number: typeof pullRequest.number === 'number' ? pullRequest.number : null,
        state: asString(pullRequest.state) || null,
        action: asString(payload.action) || null,
      },
    };
  }

  if (eventName === 'issues') {
    const issue = asObject(payload.issue);
    return {
      ...base,
      action: asString(payload.action) || undefined,
      subject: asString(issue.title) || 'issue',
      url: asString(issue.html_url) || undefined,
      occurredAt: payloadOccurredAt(payload, asString(issue.updated_at)),
      summary: {
        id: typeof issue.id === 'number' ? issue.id : null,
        number: typeof issue.number === 'number' ? issue.number : null,
        state: asString(issue.state) || null,
        action: asString(payload.action) || null,
      },
    };
  }

  if (eventName === 'issue_comment' || eventName === 'pull_request_review_comment') {
    const comment = asObject(payload.comment);
    const body = asString(comment.body);
    return {
      ...base,
      action: asString(payload.action) || 'comment',
      subject: body.slice(0, 120) || 'comment',
      url: asString(comment.html_url) || undefined,
      occurredAt: payloadOccurredAt(payload, asString(comment.updated_at)),
      summary: {
        id: typeof comment.id === 'number' ? comment.id : null,
        action: asString(payload.action) || null,
      },
    };
  }

  if (eventName === 'workflow_run') {
    const workflowRun = asObject(payload.workflow_run);
    const conclusion = asString(workflowRun.conclusion) || asString(workflowRun.status);
    return {
      ...base,
      action: conclusion || 'unknown',
      subject: asString(workflowRun.head_branch) || asString(workflowRun.name) || 'workflow_run',
      url: asString(workflowRun.html_url) || undefined,
      occurredAt: payloadOccurredAt(payload, asString(workflowRun.updated_at)),
      summary: {
        id: typeof workflowRun.id === 'number' ? workflowRun.id : null,
        ref: asString(workflowRun.head_branch) || null,
        status: conclusion || null,
      },
    };
  }

  if (eventName === 'release') {
    const release = asObject(payload.release);
    return {
      ...base,
      action: asString(payload.action) || undefined,
      subject: asString(release.name) || asString(release.tag_name) || 'release',
      url: asString(release.html_url) || undefined,
      occurredAt: payloadOccurredAt(payload, asString(release.published_at)),
      summary: {
        id: typeof release.id === 'number' ? release.id : null,
        tag: asString(release.tag_name) || null,
        action: asString(payload.action) || null,
      },
    };
  }

  return {
    ...base,
    subject: eventName || 'unsupported',
    occurredAt: payloadOccurredAt(payload),
    summary: {
      action: asString(payload.action) || null,
    },
  };
}

export function isGithubPing(eventName: string | undefined) {
  return eventName === 'ping';
}
