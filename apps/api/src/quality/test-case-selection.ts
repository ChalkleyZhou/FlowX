import type { QualityCaseSelection, QualityRetrievalSummary } from '@flowx-ai/protocol';

type Candidate = { id: string; title: string; priority: string; tags?: unknown; targetKeys?: unknown; moduleId?: string | null; coverageLinks?: Array<{ targetType: string; targetKey: string }> };
export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
export function selectQualityCases<T extends Candidate>(rows: T[], options: { requirementIds: string[]; text: string; selection?: QualityCaseSelection | null; limit?: number }): { cases: T[]; summary: QualityRetrievalSummary } {
  const selection = options.selection;
  const filtered = rows.filter((item) =>
    (!selection?.priorities?.length || selection.priorities.includes(item.priority)) &&
    (!selection?.tags?.length || selection.tags.some(tag => stringArray(item.tags).includes(tag))) &&
    (!selection?.targetKeys?.length || selection.targetKeys.some(key => stringArray(item.targetKeys).includes(key))),
  );
  const terms = options.text.toLowerCase().split(/[\s，。；、/]+/).filter(Boolean);
  const score = (item: T) => (item.coverageLinks?.some(link => link.targetType === 'REQUIREMENT' && options.requirementIds.includes(link.targetKey)) ? 1000 : 0)
    + terms.filter(term => `${item.title} ${stringArray(item.tags).join(' ')}`.toLowerCase().includes(term)).length * 10;
  const sorted = [...filtered].sort((a, b) => score(b) - score(a) || a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));
  const cases = sorted.slice(0, options.limit ?? 500);
  return { cases, summary: { eligibleCount: rows.length, matchedCount: filtered.length, suppliedCount: cases.length, truncated: cases.length < filtered.length } };
}
