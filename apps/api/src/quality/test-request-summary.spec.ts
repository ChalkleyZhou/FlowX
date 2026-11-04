import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { summarizeTestRequestScope, type RequestSummaryRun } from './test-request-summary';
import { summarizeQualityResults } from './test-report-summary';

const revision = (headSha = 'new', workflowRepositoryId = 'repo') => ({ workflowRepositoryId, branch: 'main', headSha });
const row = (id: string, result: string | null = 'PASSED', bugId: string | null = null, snapshotId = 'snapshot', key = 'web') => ({ id, snapshotId, target: { key }, result: result ? { result, bugId } : null });
const run = (id: string, cases: RequestSummaryRun['cases'], headSha = 'new'): RequestSummaryRun => ({
  id, runType: 'INITIAL', status: 'PASSED', targets: [{ key: 'web', expectedRevisions: [revision(headSha)] }], cases,
});
const initial = () => ({ ...run('initial', [row('failed', 'FAILED', 'bug')], 'old'), status: 'FAILED' });
const regression = (): RequestSummaryRun => ({ ...run('regression', [row('verified')]), runType: 'REGRESSION', sourceBugId: 'bug', sourceBug: { fixWorkflowRun: { status: 'done' } } });
const relation = () => ({ previousRunId: 'initial', regressionRunId: 'regression', testRunCaseIds: ['failed'] });
const summarize = (runs: RequestSummaryRun[]) => summarizeTestRequestScope({ runs, baseline: [revision()] });

describe('提测有效范围汇总', () => {
  it('未回归的失败保持失败', () => {
    expect(summarize([run('initial', [row('failed', 'FAILED', 'bug')])])).toEqual({ results: ['FAILED'], effectiveCaseIds: ['failed'] });
  });
  it('允许修复 SHA 与原轮次不同，显式回归替代后通过且不修改历史输入', () => {
    const input = { runs: [initial(), regression()], baseline: [revision()], supersessions: [relation()] };
    const before = structuredClone(input);
    expect(summarizeTestRequestScope(input)).toEqual({ results: ['PASSED'], effectiveCaseIds: ['verified'] });
    expect(input).toEqual(before);
  });
  it('跨工作流仓库引用按真实仓库身份匹配', () => {
    const current = regression();
    current.targets = [{ key: 'web', expectedRevisions: [revision('new', 'fix-repo')] }];
    expect(summarizeTestRequestScope({ runs: [initial(), current], baseline: [revision()], supersessions: [relation()], repositoryIdentity: new Map([['repo', 'canonical'], ['fix-repo', 'canonical']]) }).results).toEqual(['PASSED']);
  });
  it('不同缺陷来源不能替代', () => {
    expect(() => summarizeTestRequestScope({ runs: [initial(), { ...regression(), sourceBugId: 'other' }], baseline: [revision()], supersessions: [relation()] })).toThrow(BadRequestException);
  });
  it('不同代码且未显式替代的原行拒绝统计当前版本', () => {
    expect(() => summarize([initial(), regression()])).toThrow(BadRequestException);
  });
  it('原轮次未被替代的其他旧 SHA 用例仍拒绝统计', () => {
    const previous = initial();
    previous.cases = [...previous.cases, row('untested', null, null, 'other')];
    expect(() => summarizeTestRequestScope({ runs: [previous, regression()], baseline: [revision()], supersessions: [relation()] })).toThrow(BadRequestException);
  });
  it('任务汇总将冻结范围中未纳入任何轮次的用例和适用端计入未测', () => {
    const output = summarizeTestRequestScope({ runs: [run('a', [row('a')])], baseline: [revision()], requiredScopes: [
      { snapshotId: 'snapshot', targetKeys: ['web', 'ios'] },
      { snapshotId: 'unassigned', targetKeys: [] },
    ] });
    expect(output.results).toEqual(['PASSED', null, null]);
    expect(summarizeQualityResults(output.results)).toMatchObject({ total: 3, pending: 2, conclusion: 'BLOCKED' });
  });
  it('同基线相同范围结果冲突时阻塞', () => {
    expect(summarize([run('a', [row('a')]), run('b', [row('b', 'FAILED')])]).results).toEqual(['BLOCKED']);
  });
  it('同基线相同范围相同结果只计算一次', () => {
    expect(summarize([run('a', [row('a')]), run('b', [row('b')])]).results).toEqual(['PASSED']);
  });
  it('未测组合保留在分母，不能沿用另一轮已有结果', () => {
    const output = summarize([run('a', [row('a'), row('pending', null, null, 'other')])]);
    expect(output.results).toEqual(['PASSED', null]);
    expect(summarizeQualityResults(output.results)).toMatchObject({ total: 2, pending: 1, passRate: 0.5, conclusion: 'BLOCKED' });
    expect(summarize([run('a', [row('a')]), run('b', [row('b', null)])]).results).toEqual(['BLOCKED']);
  });
  it.each(['ACTIVE', 'CANCELLED'])('回归轮次尚未形成结果终态 %s 时不能替代', status => {
    expect(() => summarizeTestRequestScope({ runs: [initial(), { ...regression(), status }], baseline: [revision()], supersessions: [relation()] })).toThrow(BadRequestException);
  });
  it('活动原轮次不能被回归替代', () => {
    expect(() => summarizeTestRequestScope({ runs: [{ ...initial(), status: 'ACTIVE' }, regression()], baseline: [revision()], supersessions: [relation()] })).toThrow(BadRequestException);
  });
  it('修复未完成、原结果通过或回归没有结果都不能替代', () => {
    const variants = [
      [initial(), { ...regression(), sourceBug: { fixWorkflowRun: { status: 'running' } } }],
      [{ ...initial(), cases: [row('failed', 'PASSED', 'bug')] }, regression()],
      [initial(), { ...regression(), cases: [row('verified', null)] }],
    ];
    for (const runs of variants) expect(() => summarizeTestRequestScope({ runs, baseline: [revision()], supersessions: [relation()] })).toThrow(BadRequestException);
  });
  it('回归结果必须匹配快照和目标端', () => {
    for (const cases of [[row('verified', 'PASSED', null, 'other')], [row('verified', 'PASSED', null, 'snapshot', 'ios')]]) {
      expect(() => summarizeTestRequestScope({ runs: [initial(), { ...regression(), cases }], baseline: [revision()], supersessions: [relation()] })).toThrow(BadRequestException);
    }
  });
  it('同一原结果不能重复替代', () => {
    expect(() => summarizeTestRequestScope({ runs: [initial(), regression()], baseline: [revision()], supersessions: [relation(), relation()] })).toThrow(BadRequestException);
  });
  it('多次修复形成明确无环回归链时只统计最终结果且保留历史', () => {
    const middle = { ...regression(), status: 'FAILED', cases: [row('verified', 'FAILED', 'next-bug')] };
    const next = { ...regression(), id: 'next', sourceBugId: 'next-bug', cases: [row('next-result')] };
    const input = { runs: [initial(), middle, next], baseline: [revision()], supersessions: [relation(), { previousRunId: 'regression', regressionRunId: 'next', testRunCaseIds: ['verified'] }] };
    const before = structuredClone(input);
    expect(summarizeTestRequestScope(input)).toEqual({ results: ['PASSED'], effectiveCaseIds: ['next-result'] });
    expect(input).toEqual(before);
  });
  it('最终回归可显式替代同一缺陷的多次历史失败', () => {
    const middle = { ...regression(), id: 'middle', status: 'FAILED', cases: [row('middle-result', 'FAILED', 'bug')] };
    expect(summarizeTestRequestScope({ runs: [initial(), middle, regression()], baseline: [revision()], supersessions: [relation(), { previousRunId: 'middle', regressionRunId: 'regression', testRunCaseIds: ['middle-result'] }] })).toEqual({ results: ['PASSED'], effectiveCaseIds: ['verified'] });
  });
  it('循环替代被拒绝，即使每条边都具有合法缺陷和匹配范围', () => {
    const a = { ...regression(), id: 'a', status: 'FAILED', cases: [row('a-result', 'FAILED', 'bug')] };
    const b = { ...a, id: 'b', cases: [row('b-result', 'FAILED', 'bug')] };
    expect(() => summarizeTestRequestScope({ runs: [a, b], baseline: [revision()], supersessions: [
      { previousRunId: 'a', regressionRunId: 'b', testRunCaseIds: ['a-result'] },
      { previousRunId: 'b', regressionRunId: 'a', testRunCaseIds: ['b-result'] },
    ] })).toThrow(/循环/);
  });
  it('基线必须非空且仓库不能重复（包括同真实仓库的不同引用）', () => {
    for (const baseline of [[], [revision(), revision()], [revision(), revision('new', 'alias')]]) {
      expect(() => summarizeTestRequestScope({ runs: [run('a', [row('a')])], baseline, repositoryIdentity: new Map([['repo', 'canonical'], ['alias', 'canonical']]) })).toThrow(BadRequestException);
    }
  });
  it('未覆盖仓库、分支不匹配或仓库身份缺失时拒绝', () => {
    expect(() => summarizeTestRequestScope({ runs: [run('a', [row('a')])], baseline: [revision('new', 'other')] })).toThrow(BadRequestException);
    expect(() => summarizeTestRequestScope({ runs: [run('a', [row('a')])], baseline: [{ ...revision(), branch: 'release' }] })).toThrow(BadRequestException);
    expect(() => summarizeTestRequestScope({ runs: [run('a', [row('a')])], baseline: [revision()], repositoryIdentity: new Map() })).toThrow(BadRequestException);
  });
  it('空或部分损坏的目标代码基线不能静默丢弃', () => {
    for (const expectedRevisions of [[], [revision(), { branch: 'main' }]]) {
      expect(() => summarize([{ ...run('a', [row('a')]), targets: [{ key: 'web', expectedRevisions }] }])).toThrow(BadRequestException);
    }
  });
});
