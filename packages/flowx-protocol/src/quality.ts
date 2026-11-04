import { LOCAL_SMOKE_RESULTS, type LocalSmokeCompletionReport } from './local-smoke.js';

export const QUALITY_RUN_TYPES = ['INITIAL', 'REGRESSION'] as const;
export const QUALITY_RESULTS = LOCAL_SMOKE_RESULTS;
export const QUALITY_CAPABILITIES = ['case-selection', 'local-test-runs', 'quality-progress', 'test-reports'] as const;
export type QualityRunType = (typeof QUALITY_RUN_TYPES)[number];
export function isQualityRunType(value: unknown): value is QualityRunType {
  return typeof value === 'string' && QUALITY_RUN_TYPES.some((item) => item === value);
}
export interface QualityCaseSelection {
  libraryIds: string[];
  moduleIds?: string[];
  priorities?: string[];
  tags?: string[];
  targetKeys?: string[];
}
export interface QualityRetrievalSummary {
  eligibleCount: number;
  matchedCount: number;
  suppliedCount: number;
  truncated: boolean;
}
export interface QualityExecutionReport extends LocalSmokeCompletionReport {
  testRunRevision: number;
}
export type QualityReportMode = 'PROGRESS' | 'FINAL';
export type QualityExecutionControl = 'heartbeat' | 'release' | 'cancel';
export interface QualityReportRef {
  id: string;
  requestId: string;
  runId: string | null;
  kind: 'RUN' | 'REQUEST';
  revision: number;
  artifactId: string;
  createdAt: string;
}
