import { describe, expect, it } from 'vitest';
import { summarizeQualityResults } from './test-report-summary';
describe('测试报告事实统计', () => {
  it('失败、阻塞、跳过和未测均进入分母', () => {
    expect(summarizeQualityResults(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', null])).toEqual({ total: 5, passed: 1, failed: 1, blocked: 1, skipped: 1, pending: 1, completionRate: 0.8, passRate: 0.2, conclusion: 'FAILED' });
  });
  it('零范围与未测不可判为通过', () => {
    expect(summarizeQualityResults([])).toMatchObject({ completionRate: null, passRate: null, conclusion: 'BLOCKED' });
    expect(summarizeQualityResults(['PASSED', null])).toMatchObject({ conclusion: 'BLOCKED' });
    expect(summarizeQualityResults(['PASSED'])).toMatchObject({ conclusion: 'PASSED' });
  });
});
