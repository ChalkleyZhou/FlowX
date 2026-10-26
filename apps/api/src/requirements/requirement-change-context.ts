import { readChangePrototype } from './requirement-change-prototype';

/** 正式变更只在上下文边界合成，保留用户最初描述和已确认产物。 */
export function effectiveRequirementDescription(requirement: {
  description: string;
  changes?: ReadonlyArray<{ revision: number; content: string; prototype?: unknown }>;
}): string {
  const changes = [...(requirement.changes ?? [])].sort((a, b) => a.revision - b.revision);
  if (!changes.length) return requirement.description;
  return [requirement.description, '## 正式需求变更（以最新变更为准）',
    '以下为正式增量要求。与旧描述或已确认产物冲突时，以最新变更为准；仍无法消解的冲突须明确列出并澄清。',
    ...changes.map((change) => [`### 修订 ${change.revision}\n${change.content}`, (() => {
      const analysis = readChangePrototype(change.prototype)?.snapshot?.analysis;
      return analysis ? `本次原型整理（替代此前原型材料，以本次为准）：\n${analysis.description}\n验收标准：\n${analysis.acceptanceCriteria.join('\n')}` : '';
    })()].filter(Boolean).join('\n\n')),
  ].join('\n\n');
}

export function readRequirementRevision(input: unknown): number {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 0;
  const revision = (input as Record<string, unknown>).requirementRevision;
  return typeof revision === 'number' && Number.isInteger(revision) ? revision : 0;
}
