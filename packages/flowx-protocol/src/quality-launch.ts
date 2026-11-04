import type { TestedRepositoryRevision } from './local-smoke.js';
export type LocalLaunchPurpose = 'quality-test';
export interface QualityLaunchRepository extends TestedRepositoryRevision { url: string; name?: string }
export interface QualityLocalLaunchRedeemed {
  purpose: 'quality-test';
  apiBaseUrl: string;
  testRunId: string;
  executionSessionId: string;
  repositories: QualityLaunchRepository[];
  chatPrompt: string;
  mcpToken: string;
  mcpTokenExpiresAt: string;
}
export function isQualityLocalLaunchRedeemed(value: unknown): value is QualityLocalLaunchRedeemed {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.purpose !== 'quality-test' || !['apiBaseUrl', 'testRunId', 'executionSessionId', 'chatPrompt', 'mcpToken', 'mcpTokenExpiresAt'].every(key => typeof record[key] === 'string' && (record[key] as string).trim().length > 0)) return false;
  return Array.isArray(record.repositories) && record.repositories.length > 0 && record.repositories.every(item => item && typeof item === 'object' && ['workflowRepositoryId', 'url', 'branch', 'headSha'].every(key => typeof item[key] === 'string' && item[key].trim().length > 0));
}
