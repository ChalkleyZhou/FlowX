import { describe, expect, it } from 'vitest';
import { QUALITY_RUN_TYPES, QUALITY_RESULTS, isQualityRunType, type QualityCaseSelection, type QualityExecutionReport } from './quality.js';

describe('质量执行跨端契约', () => {
  it('仅接受受支持的测试类型，冒烟沿用原入口', () => {
    expect(QUALITY_RUN_TYPES).toEqual(['INITIAL', 'REGRESSION']);
    expect(isQualityRunType('INITIAL')).toBe(true);
    expect(isQualityRunType('LOCAL_SMOKE')).toBe(false);
    expect(QUALITY_RESULTS).toEqual(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED']);
  });
  it('序列化保留选择范围、版本和逐例证据', () => {
    const selection: QualityCaseSelection = { libraryIds: ['library-1'], moduleIds: ['module-1'], targetKeys: ['web'] };
    const report: QualityExecutionReport = { idempotencyKey: 'batch-1', sourceFingerprint: 'source-1', testRunRevision: 0, testedRevisions: [{ workflowRepositoryId: 'repo-1', branch: 'test', headSha: 'abc' }], caseResults: [{ testRunCaseId: 'case-1', result: 'FAILED', artifactIds: ['log-1'] }] };
    expect(JSON.parse(JSON.stringify({ selection, report }))).toEqual({ selection, report });
  });
});
