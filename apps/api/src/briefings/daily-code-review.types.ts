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

export function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : String(item)))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
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
