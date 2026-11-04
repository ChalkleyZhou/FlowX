import { BadRequestException } from '@nestjs/common';
import { qualityRevisions } from './local-test-execution';
import type { TestedRepositoryRevision } from '@flowx-ai/protocol';

export interface RequestSummaryRun {
  id: string;
  runType: string;
  status: string;
  sourceBugId?: string | null;
  sourceBug?: { fixWorkflowRun?: { status: string } | null } | null;
  targets: readonly { key: string; expectedRevisions: unknown }[];
  cases: readonly { id: string; snapshotId: string; target?: { key: string } | null; result?: { result: string; bugId?: string | null } | null }[];
}
export interface RequestSummarySupersession {
  previousRunId: string;
  regressionRunId: string;
  testRunCaseIds: readonly string[];
}
export interface RequiredQualityScope { snapshotId: string; targetKeys: readonly string[] }
export function missingQualityScopes(required: readonly RequiredQualityScope[], covered: readonly { snapshotId: string; targetKey: string | null }[]) {
  const existing = new Map<string, Set<string | null>>();
  for (const item of covered) {
    const keys = existing.get(item.snapshotId) ?? new Set<string | null>();
    keys.add(item.targetKey);
    existing.set(item.snapshotId, keys);
  }
  return required.flatMap<{ snapshotId: string; targetKey: string | null }>(item => {
    const keys = existing.get(item.snapshotId);
    if (!item.targetKeys.length) return keys?.size ? [] : [{ snapshotId: item.snapshotId, targetKey: null }];
    return [...new Set(item.targetKeys)].filter(key => !keys?.has(key)).map(targetKey => ({ snapshotId: item.snapshotId, targetKey }));
  });
}
export interface TestRequestSummaryInput {
  runs: readonly RequestSummaryRun[];
  baseline: readonly TestedRepositoryRevision[];
  supersessions?: readonly RequestSummarySupersession[];
  repositoryIdentity?: ReadonlyMap<string, string>;
  requiredScopes?: readonly RequiredQualityScope[];
}
/** 保留所有有效物理行 ID，统计结果按快照与目标端组合去重，不修改历史事实。 */
export function summarizeTestRequestScope(input: TestRequestSummaryInput): { results: Array<string | null>; effectiveCaseIds: string[] } {
  const identity = (id: string) => {
    const canonical = input.repositoryIdentity ? input.repositoryIdentity.get(id) : id;
    if (!canonical?.trim()) throw new BadRequestException('代码基线缺少真实仓库身份。');
    return canonical;
  };
  const revisionsByRepository = (value: unknown) => {
    const revisions = qualityRevisions(value);
    if (!Array.isArray(value) || !revisions.length || revisions.length !== value.length || revisions.some(item => !item.workflowRepositoryId.trim() || !item.branch.trim() || !item.headSha.trim())) {
      throw new BadRequestException('必须选择完整且明确的代码基线。');
    }
    const byRepository = new Map<string, TestedRepositoryRevision>();
    for (const item of revisions) {
      const key = identity(item.workflowRepositoryId);
      if (byRepository.has(key)) throw new BadRequestException('代码基线仓库重复。');
      byRepository.set(key, item);
    }
    return byRepository;
  };
  const baseline = revisionsByRepository(input.baseline);
  const runsById = new Map(input.runs.map(run => [run.id, run]));
  if (!input.runs.length || runsById.size !== input.runs.length) throw new BadRequestException('汇总必须选择独立且不重复的测试轮次。');
  const caseIds = input.runs.flatMap(run => run.cases.map(item => item.id));
  if (new Set(caseIds).size !== caseIds.length) throw new BadRequestException('汇总包含重复用例行。');
  const relations = input.supersessions ?? [];
  const replaced = new Set<string>();
  const replacementEdges = new Map<string, string>();
  const ended = (run: RequestSummaryRun) => ['PASSED', 'FAILED', 'BLOCKED'].includes(run.status);
  const scopeKey = (item: RequestSummaryRun['cases'][number]) => JSON.stringify([item.snapshotId, item.target?.key ?? null]);
  for (const relation of relations) {
    const previous = runsById.get(relation.previousRunId);
    const regression = runsById.get(relation.regressionRunId);
    if (!previous || !regression || previous.id === regression.id || !ended(previous) || !ended(regression) || regression.runType !== 'REGRESSION' || !regression.sourceBugId || regression.sourceBug?.fixWorkflowRun?.status.toLowerCase() !== 'done' || !relation.testRunCaseIds.length) {
      throw new BadRequestException('回归替代要求已完成修复及独立、已结束的原轮次与回归轮次。');
    }
    for (const id of relation.testRunCaseIds) {
      const source = previous.cases.find(item => item.id === id);
      const candidates = source ? regression.cases.filter(item => scopeKey(item) === scopeKey(source)) : [];
      const verified = candidates.length === 1 ? candidates[0] : null;
      if (!source || !['FAILED', 'BLOCKED'].includes(source.result?.result ?? '') || source.result?.bugId !== regression.sourceBugId || !verified?.result || replaced.has(id)) {
        throw new BadRequestException('回归只能一次替代该缺陷关联的失败或阻塞用例，且必须匹配快照、目标端并具有结果。');
      }
      replaced.add(id);
      replacementEdges.set(id, verified.id);
    }
  }
  // 每条原始事实只能替代一次，但同一最终回归可承接多次失败；拒绝循环。
  const visited = new Set<string>();
  for (const start of replacementEdges.keys()) {
    const path = new Set<string>();
    let current: string | undefined = start;
    while (current && !visited.has(current)) {
      if (path.has(current)) throw new BadRequestException('回归替代不能形成循环。');
      path.add(current);
      current = replacementEdges.get(current);
    }
    for (const id of path) visited.add(id);
  }
  const grouped = new Map<string, Set<string | null>>();
  const effectiveCaseIds: string[] = [];
  const effectiveScopes: Array<{ snapshotId: string; targetKey: string | null }> = [];
  for (const run of input.runs) {
    for (const item of run.cases) {
      if (replaced.has(item.id)) continue;
      const targets = item.target ? run.targets.filter(target => target.key === item.target!.key) : run.targets;
      if (!targets.length || (item.target && targets.length !== 1)) throw new BadRequestException('有效用例缺少明确目标端代码基线。');
      for (const target of targets) {
        for (const [repository, revision] of revisionsByRepository(target.expectedRevisions)) {
          const selected = baseline.get(repository);
          if (!selected || selected.branch !== revision.branch || selected.headSha !== revision.headSha) {
            throw new BadRequestException('有效范围包含不同代码基线；请显式回归替代旧结果或分别生成报告，不能宣称当前版本已验证。');
          }
        }
      }
      effectiveCaseIds.push(item.id);
      effectiveScopes.push({ snapshotId: item.snapshotId, targetKey: item.target?.key ?? null });
      const key = scopeKey(item);
      const values = grouped.get(key) ?? new Set<string | null>();
      values.add(item.result?.result ?? null);
      grouped.set(key, values);
    }
  }
  const missing = missingQualityScopes(input.requiredScopes ?? [], effectiveScopes);
  return { results: [...grouped.values()].map(values => values.size > 1 ? 'BLOCKED' : values.values().next().value ?? null).concat(missing.map(() => null)), effectiveCaseIds };
}
