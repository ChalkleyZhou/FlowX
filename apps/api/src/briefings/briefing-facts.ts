import type { NormalizedBriefingEvent } from './briefing-events';
import {
  categorizeCommitMessage,
  collectDailyCommits,
  summarizeDailyCommits,
  type BriefingCommit,
  type CommitCategory,
} from './briefing-commits';
import type { BriefingPeriod } from './dto/generate-briefing.dto';

export interface BriefingFactsPayload {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  projectName: string;
  overview: {
    repositoryCount: number;
    commitCount: number;
  };
  commits: Array<{
    id: string;
    repository: string;
    ref?: string;
    message: string;
    author?: string;
    category: CommitCategory;
    scope?: string;
  }>;
}

interface BuildFactsInput {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
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

function commitScope(message: string) {
  return message.split('\n')[0]?.trim().match(/^[a-z]+\(([^)]+)\)!?:/i)?.[1];
}

function commitFacts(commits: BriefingCommit[]) {
  return commits.slice(0, MAX_COMMITS).map((commit) => ({
    id: commit.id,
    repository: commit.projectName,
    ref: commit.ref,
    message: truncateMessage(commit.message),
    author: commit.author,
    category: categorizeCommitMessage(commit.message),
    scope: commitScope(commit.message),
  }));
}

export function buildBriefingFacts(input: BuildFactsInput): BriefingFactsPayload {
  const eventInputs = input.events.map((event, index) => ({
    event,
    rawPayload: input.rawPayloadByEventIndex?.[index],
  }));
  const commits = collectDailyCommits(eventInputs);
  const commitSummary = summarizeDailyCommits(commits);
  return {
    period: input.period,
    date: input.date,
    rangeLabel: input.rangeLabel,
    projectName: input.projectName,
    overview: {
      repositoryCount: commitSummary.repositoryCount,
      commitCount: commitSummary.totalCommits,
    },
    commits: commitFacts(commits),
  };
}
