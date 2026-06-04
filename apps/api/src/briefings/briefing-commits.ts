import type { NormalizedBriefingEvent } from './briefing-events';

export interface BriefingCommit {
  id: string;
  message: string;
  author?: string;
  projectName: string;
  ref?: string;
  occurredAt: string;
}

export type CommitCategory = 'feature' | 'fix' | 'other';

export interface CategorizedCommit extends BriefingCommit {
  category: CommitCategory;
  title: string;
}

export interface DailyCommitSummary {
  totalCommits: number;
  repositoryCount: number;
  features: CategorizedCommit[];
  fixes: CategorizedCommit[];
  other: CategorizedCommit[];
}

type RawPayload = Record<string, unknown>;

function asObject(value: unknown): RawPayload {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawPayload)
    : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function firstLine(message: string) {
  return message.split('\n')[0]?.trim() || message.trim();
}

export function categorizeCommitMessage(message: string): CommitCategory {
  const line = firstLine(message).toLowerCase();
  if (/^(feat|feature)(\(|:|\s)/.test(line)) {
    return 'feature';
  }
  if (/^(fix|bugfix|hotfix|patch)(\(|:|\s)/.test(line)) {
    return 'fix';
  }
  if (/\b(fix|修复|bug)\b/.test(line) && !/^feat/.test(line)) {
    return 'fix';
  }
  if (/\b(feat|功能|新增|add)\b/.test(line) && !/^fix/.test(line)) {
    return 'feature';
  }
  return 'other';
}

function parseWebhookCommits(
  payload: RawPayload,
  projectName: string,
  ref: string | undefined,
  occurredAt: string,
): BriefingCommit[] {
  const commits = payload.commits;
  if (!Array.isArray(commits)) {
    return [];
  }

  return commits
    .map((entry) => {
      const commit = asObject(entry);
      const id = asString(commit.id) || asString(commit.sha);
      const message =
        asString(commit.message) ||
        asString(commit.title) ||
        asString(asObject(commit.commit).message);
      if (!id || !message) {
        return null;
      }
      const author =
        asString(asObject(commit.author).name) ||
        asString(commit.author_name) ||
        asString(asObject(commit.committer).name) ||
        undefined;
      return {
        id,
        message,
        author,
        projectName,
        ref,
        occurredAt,
      };
    })
    .filter((item): item is BriefingCommit => item !== null);
}

function parseNormalizedCommits(event: NormalizedBriefingEvent): BriefingCommit[] {
  if (!event.commits?.length) {
    return [];
  }

  const ref = asString(event.summary.ref) || undefined;
  return event.commits
    .map((commit) => {
      if (!commit.id || !commit.message) {
        return null;
      }
      return {
        id: commit.id,
        message: commit.message,
        author: commit.author,
        projectName: event.projectName,
        ref,
        occurredAt: event.occurredAt,
      };
    })
    .filter((item): item is BriefingCommit => item !== null);
}

export function extractCommitsFromPush(
  event: NormalizedBriefingEvent,
  rawPayload?: unknown,
): BriefingCommit[] {
  if (event.eventType !== 'push') {
    return [];
  }

  const fromNormalized = parseNormalizedCommits(event);
  if (fromNormalized.length > 0) {
    return fromNormalized;
  }

  if (!rawPayload) {
    return [];
  }

  const payload = asObject(rawPayload);
  const ref = asString(event.summary.ref) || asString(payload.ref).replace(/^refs\/(heads|tags)\//, '');
  return parseWebhookCommits(payload, event.projectName, ref || undefined, event.occurredAt);
}

export function collectDailyCommits(
  events: Array<{ event: NormalizedBriefingEvent; rawPayload?: unknown }>,
): BriefingCommit[] {
  const seen = new Set<string>();
  const commits: BriefingCommit[] = [];

  for (const { event, rawPayload } of events) {
    const extracted =
      event.eventType === 'push'
        ? extractCommitsFromPush(event, rawPayload)
        : [];
    for (const commit of extracted) {
      const key = `${event.projectName}:${commit.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      commits.push(commit);
    }
  }

  return commits;
}

export function summarizeDailyCommits(commits: BriefingCommit[]): DailyCommitSummary {
  const categorized = commits.map((commit) => {
    const category = categorizeCommitMessage(commit.message);
    return {
      ...commit,
      category,
      title: firstLine(commit.message),
    };
  });

  return {
    totalCommits: categorized.length,
    repositoryCount: new Set(categorized.map((item) => item.projectName)).size,
    features: categorized.filter((item) => item.category === 'feature'),
    fixes: categorized.filter((item) => item.category === 'fix'),
    other: categorized.filter((item) => item.category === 'other'),
  };
}

export function formatCommitBullet(commit: CategorizedCommit | BriefingCommit & { title?: string }) {
  const title = 'title' in commit && commit.title ? commit.title : firstLine(commit.message);
  const author = commit.author ? ` — ${commit.author}` : '';
  const repo = commit.projectName ? ` [${commit.projectName}]` : '';
  return `- ${title}${repo}${author}`;
}
