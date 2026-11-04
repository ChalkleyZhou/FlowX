import { createHash } from 'node:crypto';
import type { TestedRepositoryRevision } from '@flowx-ai/protocol';
export function qualityHash(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).filter(([, val]) => val !== undefined).map(([key, val]) => [key, normalize(val)])) : item;
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
export function qualityRevisions(value: unknown): TestedRepositoryRevision[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TestedRepositoryRevision => !!item && typeof item === 'object' && typeof item.workflowRepositoryId === 'string' && typeof item.branch === 'string' && typeof item.headSha === 'string')
    .map(({ workflowRepositoryId, branch, headSha }) => ({ workflowRepositoryId, branch, headSha })).sort((a, b) => a.workflowRepositoryId.localeCompare(b.workflowRepositoryId));
}
export function qualityRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
