export const LOCAL_SMOKE_RESULTS = ['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'] as const;

export type LocalSmokeResult = (typeof LOCAL_SMOKE_RESULTS)[number];

export interface TestedRepositoryRevision {
  workflowRepositoryId: string;
  branch: string;
  headSha: string;
}

export interface LocalSmokeCaseResult {
  testRunCaseId: string;
  result: LocalSmokeResult;
  durationMs?: number;
  actualResult?: string;
  remark?: string;
  artifactIds?: string[];
}

export interface LocalSmokeCompletionReport {
  idempotencyKey: string;
  sourceFingerprint: string;
  environment?: Record<string, unknown>;
  testedRevisions: TestedRepositoryRevision[];
  caseResults: LocalSmokeCaseResult[];
  summary?: string;
  artifactIds?: string[];
}
