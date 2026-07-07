import type { NormalizedBriefingEvent } from './briefing-events';

export interface BriefingCommit {
  id: string;
  message: string;
  author?: string;
  projectName: string;
  repositoryId?: string;
  ref?: string;
  occurredAt: string;
}

/** Conventional commit types from @commitlint/config-conventional */
export const COMMITLINT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

export type CommitlintType = (typeof COMMITLINT_TYPES)[number];
export type CommitCategory = CommitlintType | 'other';

export const COMMIT_CATEGORY_ORDER: CommitCategory[] = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'style',
  'revert',
  'other',
];

export const COMMIT_CATEGORY_LABELS: Record<CommitCategory, string> = {
  feat: '新功能',
  fix: '问题修复',
  perf: '性能优化',
  refactor: '重构',
  docs: '文档',
  test: '测试',
  build: '构建',
  ci: 'CI',
  chore: '杂项维护',
  style: '样式',
  revert: '回滚',
  other: '其它提交',
};

const CONVENTIONAL_COMMIT_TYPE_RE =
  /^(feat|feature|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w\-./\s]+\))?!?:\s*.+/i;

export interface CategorizedCommit extends BriefingCommit {
  category: CommitCategory;
  title: string;
}

export interface DailyCommitSummary {
  totalCommits: number;
  repositoryCount: number;
  byCategory: Record<CommitCategory, CategorizedCommit[]>;
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

function emptyCategoryMap(): Record<CommitCategory, CategorizedCommit[]> {
  return Object.fromEntries(
    COMMIT_CATEGORY_ORDER.map((category) => [category, [] as CategorizedCommit[]]),
  ) as Record<CommitCategory, CategorizedCommit[]>;
}

/** Skip commit titles that carry little product meaning in a daily report. */
export function isMeaningfulCommitMessage(message: string): boolean {
  const line = firstLine(message);
  if (line.length < 4) {
    return false;
  }
  if (CONVENTIONAL_COMMIT_TYPE_RE.test(line)) {
    return true;
  }
  const lower = line.toLowerCase();
  if (/^(翻译|translation|merge|merged|wip|update|updates|bump|tmp|temp|sync)$/i.test(line)) {
    return false;
  }
  if (/^merge\b/i.test(lower)) {
    return false;
  }
  if (/^(chore|style|refactor|revert|test)$/i.test(line)) {
    return false;
  }
  return true;
}

export function parseConventionalCommitType(message: string): CommitCategory | null {
  const line = firstLine(message);
  const match = line.match(
    /^(feat|feature|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w\-./\s]+\))?!?:/i,
  );
  if (!match) {
    return null;
  }
  const rawType = match[1].toLowerCase();
  if (rawType === 'feature') {
    return 'feat';
  }
  return rawType as CommitlintType;
}

export function categorizeCommitMessage(message: string): CommitCategory {
  const conventional = parseConventionalCommitType(message);
  if (conventional) {
    return conventional;
  }

  const line = firstLine(message).toLowerCase();
  if (/\b(fix|修复|bug)\b/.test(line) && !/^feat/.test(line)) {
    return 'fix';
  }
  if (/\b(feat|功能|新增|add)\b/.test(line) && !/^fix/.test(line)) {
    return 'feat';
  }
  if (/\b(docs?|文档|readme)\b/.test(line)) {
    return 'docs';
  }
  if (/\b(chore|deps|dependency|bump)\b/.test(line)) {
    return 'chore';
  }
  if (/\b(refactor|重构)\b/.test(line)) {
    return 'refactor';
  }
  if (/\b(test|测试)\b/.test(line)) {
    return 'test';
  }
  return 'other';
}

function buildBriefingCommit(input: {
  id: string;
  message: string;
  author?: string;
  projectName: string;
  ref?: string;
  occurredAt: string;
}): BriefingCommit {
  const commit: BriefingCommit = {
    id: input.id,
    message: input.message,
    projectName: input.projectName,
    occurredAt: input.occurredAt,
  };
  if (input.author) {
    commit.author = input.author;
  }
  if (input.ref) {
    commit.ref = input.ref;
  }
  return commit;
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

  const parsed: BriefingCommit[] = [];
  for (const entry of commits) {
    const commit = asObject(entry);
    const id = asString(commit.id) || asString(commit.sha);
    const message =
      asString(commit.message) ||
      asString(commit.title) ||
      asString(asObject(commit.commit).message);
    if (!id || !message) {
      continue;
    }
    const author =
      asString(asObject(commit.author).name) ||
      asString(commit.author_name) ||
      asString(asObject(commit.committer).name) ||
      undefined;
    parsed.push(
      buildBriefingCommit({
        id,
        message,
        author,
        projectName,
        ref,
        occurredAt,
      }),
    );
  }
  return parsed;
}

function parseNormalizedCommits(event: NormalizedBriefingEvent): BriefingCommit[] {
  if (!event.commits?.length) {
    return [];
  }

  const ref = asString(event.summary.ref) || undefined;
  const parsed: BriefingCommit[] = [];
  for (const commit of event.commits) {
    if (!commit.id || !commit.message) {
      continue;
    }
    parsed.push(
      buildBriefingCommit({
        id: commit.id,
        message: commit.message,
        author: commit.author,
        projectName: event.projectName,
        ref,
        occurredAt: event.occurredAt,
      }),
    );
  }
  return parsed;
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
  events: Array<{
    event: NormalizedBriefingEvent;
    rawPayload?: unknown;
    repositoryId?: string;
  }>,
): BriefingCommit[] {
  const seen = new Set<string>();
  const commits: BriefingCommit[] = [];

  for (const { event, rawPayload, repositoryId } of events) {
    const extracted =
      event.eventType === 'push'
        ? extractCommitsFromPush(event, rawPayload)
        : [];
    for (const commit of extracted) {
      const key = `${repositoryId ?? event.projectName}:${commit.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      commits.push(
        repositoryId
          ? {
              ...commit,
              repositoryId,
            }
          : commit,
      );
    }
  }

  return commits;
}

export function summarizeDailyCommits(commits: BriefingCommit[]): DailyCommitSummary {
  const meaningful = commits.filter((commit) => isMeaningfulCommitMessage(commit.message));
  const byCategory = emptyCategoryMap();

  for (const commit of meaningful) {
    const category = categorizeCommitMessage(commit.message);
    byCategory[category].push({
      ...commit,
      category,
      title: firstLine(commit.message),
    });
  }

  const categorized = COMMIT_CATEGORY_ORDER.flatMap((category) => byCategory[category]);

  return {
    totalCommits: categorized.length,
    repositoryCount: new Set(categorized.map((item) => item.projectName)).size,
    byCategory,
  };
}

export function orderedCommitCategoryGroups(summary: DailyCommitSummary) {
  return COMMIT_CATEGORY_ORDER.map((category) => ({
    category,
    label: COMMIT_CATEGORY_LABELS[category],
    commits: summary.byCategory[category],
  })).filter((group) => group.commits.length > 0);
}

export function formatCommitBullet(commit: CategorizedCommit | BriefingCommit & { title?: string }) {
  const title = 'title' in commit && commit.title ? commit.title : firstLine(commit.message);
  const author = commit.author ? ` — ${commit.author}` : '';
  const repo = commit.projectName ? ` [${commit.projectName}]` : '';
  return `- ${title}${repo}${author}`;
}
