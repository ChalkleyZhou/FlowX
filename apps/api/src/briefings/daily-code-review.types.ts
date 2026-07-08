import type { DailyCodeReviewUnitStatus, ReviewCodeOutput } from '../common/types';
import type { BriefingCommit } from './briefing-commits';

export interface DailyCodeReviewUnitResult {
  repositoryName: string;
  repositoryId: string | null;
  ref: string;
  commits: Array<Pick<BriefingCommit, 'id' | 'message' | 'author'>>;
  status: DailyCodeReviewUnitStatus;
  skillHint?: string;
  errorMessage?: string;
  findings?: ReviewCodeOutput;
}

function stringifyFindingItem(item: unknown): string {
  if (typeof item === 'string') {
    return item.trim();
  }
  if (typeof item === 'number' || typeof item === 'boolean') {
    return String(item);
  }
  if (!item || typeof item !== 'object') {
    return '';
  }
  if (Array.isArray(item)) {
    return coerceStringArray(item).join('；');
  }

  const record = item as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const bodyCandidates = [
    record.description,
    record.message,
    record.summary,
    record.text,
    record.detail,
    record.content,
    record.issue,
    record.bug,
    record.suggestion,
  ];
  const body = bodyCandidates.find(
    (value): value is string => typeof value === 'string' && Boolean(value.trim()),
  )?.trim();

  if (title && body && title !== body) {
    return `${title}：${body}`;
  }
  if (body) {
    return body;
  }
  if (title) {
    return title;
  }

  // Last resort: avoid "[object Object]" by joining remaining string values.
  return Object.values(record)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .join('；');
}

export function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(stringifyFindingItem).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  if (value && typeof value === 'object') {
    const text = stringifyFindingItem(value);
    return text ? [text] : [];
  }
  return [];
}

export function normalizeReviewFindings(
  output: Partial<ReviewCodeOutput> | null | undefined,
): ReviewCodeOutput {
  return {
    issues: coerceStringArray(output?.issues),
    bugs: coerceStringArray(output?.bugs),
    missingTests: coerceStringArray(output?.missingTests),
    suggestions: coerceStringArray(output?.suggestions),
    impactScope: coerceStringArray(output?.impactScope),
  };
}

export function deriveDailyCodeReviewStatus(units: DailyCodeReviewUnitResult[]) {
  if (units.length === 0) {
    return 'SKIPPED_NO_CHANGES';
  }
  if (units.some((unit) => unit.status === 'COMPLETED')) {
    return 'COMPLETED';
  }
  if (units.every((unit) => unit.status === 'SKIPPED_NO_SKILL')) {
    return 'SKIPPED_NO_SKILL';
  }
  if (units.every((unit) => unit.status === 'SKIPPED_NO_CHANGES')) {
    return 'SKIPPED_NO_CHANGES';
  }
  if (units.some((unit) => unit.status === 'FAILED')) {
    return 'FAILED';
  }
  return 'GENERATED';
}
