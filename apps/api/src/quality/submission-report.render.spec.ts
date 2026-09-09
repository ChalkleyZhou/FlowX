import { describe, expect, it } from 'vitest';
import { renderSubmissionReport } from './submission-report.render';

describe('renderSubmissionReport', () => {
  it('renders tested revisions and escaped evidence ids', () => {
    const html = renderSubmissionReport({
      revision: 2,
      generatedAt: new Date('2026-09-09T05:00:00.000Z'),
      run: {
        id: 'run-1',
        name: '多人冒烟',
        sourceFingerprint: 'fingerprint-1',
        testPlan: { testRequest: { title: '支付 <提测>', projectVersion: { name: 'v1' } } },
        targets: [
          {
            id: 'target-web',
            key: 'web',
            name: 'Web',
            required: true,
            status: 'PASSED',
            expectedRevisions: [
              { workflowRepositoryId: 'wr-1', branch: 'feature/pay', headSha: 'deadbeef' },
            ],
          },
        ],
        cases: [
          {
            id: 'case-1',
            targetId: 'target-web',
            required: true,
            blocking: true,
            snapshot: { title: '提交支付', priority: 'P0', expected: '成功' },
            result: {
              result: 'PASSED',
              actualResult: '成功',
              remark: null,
              evidence: { artifactIds: ['log<1>'] },
            },
          },
        ],
        executions: [
          {
            id: 'execution-1',
            status: 'COMPLETED',
            claimedByUser: { displayName: '张三' },
            deviceId: 'mac-1',
            testedRevisions: [
              { workflowRepositoryId: 'wr-1', branch: 'feature/pay', headSha: 'deadbeef' },
            ],
            environment: { os: 'macOS', browser: 'Chrome' },
            summary: '通过',
            startedAt: new Date('2026-09-09T04:00:00.000Z'),
            completedAt: new Date('2026-09-09T04:05:00.000Z'),
          },
        ],
      },
    });

    expect(html).toContain('deadbeef');
    expect(html).toContain('Chrome');
    expect(html).toContain('log&lt;1&gt;');
    expect(html).not.toContain('支付 <提测>');
  });
});
