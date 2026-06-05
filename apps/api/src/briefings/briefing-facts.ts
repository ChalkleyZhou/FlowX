import type { NormalizedBriefingEvent } from './briefing-events';
import {
  categorizeCommitMessage,
  collectDailyCommits,
  summarizeDailyCommits,
  type BriefingCommit,
  type CommitCategory,
} from './briefing-commits';

export interface BriefingFactsPayload {
  date: string;
  projectName: string;
  overview: {
    eventCount: number;
    repositoryCount: number;
    commitCount: number;
    mergeRequestCount: number;
    issueCount: number;
    failedPipelineCount: number;
  };
  commits: Array<{
    repository: string;
    ref?: string;
    message: string;
    author?: string;
    category: CommitCategory;
  }>;
  mergeRequests: Array<{
    repository: string;
    action?: string;
    title: string;
    state?: string | null;
  }>;
  issues: Array<{
    repository: string;
    action?: string;
    title: string;
    state?: string | null;
  }>;
  pipelines: Array<{
    repository: string;
    ref?: string | null;
    status?: string | null;
    action?: string;
  }>;
  releases: Array<{
    repository: string;
    title: string;
    action?: string;
  }>;
}

interface BuildFactsInput {
  date: string;
  projectName: string;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
}

const MAX_COMMITS = 80;
const MAX_MESSAGE_LENGTH = 280;

function truncateMessage(message: string) {
  const line = message.split('\n')[0]?.trim() || message.trim();
  if (line.length <= MAX_MESSAGE_LENGTH) {
    return line;
  }
  return `${line.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

function commitFacts(commits: BriefingCommit[]) {
  return commits.slice(0, MAX_COMMITS).map((commit) => ({
    repository: commit.projectName,
    ref: commit.ref,
    message: truncateMessage(commit.message),
    author: commit.author,
    category: categorizeCommitMessage(commit.message),
  }));
}

export function buildBriefingFacts(input: BuildFactsInput): BriefingFactsPayload {
  const eventInputs = input.events.map((event, index) => ({
    event,
    rawPayload: input.rawPayloadByEventIndex?.[index],
  }));
  const commits = collectDailyCommits(eventInputs);
  const commitSummary = summarizeDailyCommits(commits);
  const repositories = new Set(input.events.map((event) => event.projectName));

  const mergeRequests = input.events
    .filter((event) => event.eventType === 'merge_request')
    .map((event) => ({
      repository: event.projectName,
      action: event.action,
      title: event.subject,
      state:
        typeof event.summary.state === 'string' ? event.summary.state : null,
    }));

  const issues = input.events
    .filter((event) => event.eventType === 'issue')
    .map((event) => ({
      repository: event.projectName,
      action: event.action,
      title: event.subject,
      state:
        typeof event.summary.state === 'string' ? event.summary.state : null,
    }));

  const pipelines = input.events
    .filter((event) => event.eventType === 'pipeline')
    .map((event) => ({
      repository: event.projectName,
      ref: typeof event.summary.ref === 'string' ? event.summary.ref : null,
      status: typeof event.summary.status === 'string' ? event.summary.status : null,
      action: event.action,
    }));

  const releases = input.events
    .filter((event) => event.eventType === 'release' || event.eventType === 'tag')
    .map((event) => ({
      repository: event.projectName,
      title: event.subject,
      action: event.action,
    }));

  return {
    date: input.date,
    projectName: input.projectName,
    overview: {
      eventCount: input.events.length,
      repositoryCount: repositories.size,
      commitCount: commitSummary.totalCommits,
      mergeRequestCount: mergeRequests.length,
      issueCount: issues.length,
      failedPipelineCount: pipelines.filter(
        (item) => item.status === 'failed' || item.action === 'failed' || item.action === 'failure',
      ).length,
    },
    commits: commitFacts(commits),
    mergeRequests,
    issues,
    pipelines,
    releases,
  };
}
