import type { SourceTool } from './execution-session.js';

export const ARTIFACT_TYPES = [
  'DESIGN_HTML',
  'PLAN_HTML',
  'EXECUTION_REPORT',
  'DIFF_SUMMARY',
  'TEST_REPORT',
  'SCREENSHOT',
  'VIDEO',
  'LOG',
  'COVERAGE',
  'GIT_REFERENCE',
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_STORAGE_PROVIDERS = ['local', 'minio', 's3', 'external'] as const;

export type ArtifactStorageProvider = (typeof ARTIFACT_STORAGE_PROVIDERS)[number];

export const ARTIFACT_STATUSES = ['PENDING', 'AVAILABLE', 'FAILED', 'DELETED'] as const;

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const EVIDENCE_TYPES = [
  'GIT_COMMIT',
  'REMOTE_BRANCH_VERIFICATION',
  'CHANGED_FILES',
  'TEST_RESULT',
  'BUILD_RESULT',
  'USER_CONFIRMATION',
  'AGENT_SUMMARY',
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_STATUSES = ['REPORTED', 'VERIFIED', 'REJECTED'] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export interface ArtifactManifest {
  artifactType: ArtifactType;
  name: string;
  version: string;
  storageProvider: ArtifactStorageProvider;
  storageKey?: string;
  externalUrl?: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  metadata?: Record<string, unknown>;
}

export interface EvidenceReport {
  evidenceType: EvidenceType;
  sourceTool: SourceTool;
  title: string;
  summary?: string;
  occurredAt: string;
  artifactId?: string;
  metadata?: Record<string, unknown>;
}
