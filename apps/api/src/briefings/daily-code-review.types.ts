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
