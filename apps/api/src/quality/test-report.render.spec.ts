import { describe, expect, it } from 'vitest';
import { renderQualityTestReport, type QualityReportSnapshot } from './test-report.render';
import { summarizeQualityResults } from './test-report-summary';

function snapshot(): QualityReportSnapshot {
  return {
    mode: 'PROGRESS', generatedAt: '2026-11-04T00:00:00.000Z',
    request: { id: 'request', title: '功能验证', project: '项目', version: 'v1', requirements: [{ id: 'requirement', title: '用户需求' }] },
    summary: summarizeQualityResults(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', null]),
    baseline: [{ workflowRepositoryId: 'repository', branch: 'main', headSha: 'fixed-sha' }],
    supersessions: [{ previousRunId: 'old-run', regressionRunId: 'regression', testRunCaseIds: ['old-case'] }],
    runs: [{ id: 'old-run', name: '原始失败轮次', runType: 'INITIAL', status: 'FAILED',
      targets: [{ key: 'web', expectedRevisions: [{ branch: 'main', headSha: 'old-sha' }] }],
      executions: [{ id: 'execution', testedRevisions: [{ headSha: 'old-sha' }], environment: { browser: 'Chrome' } }],
      cases: [{ id: 'old-case', title: '历史失败用例', target: '网页端', priority: 'P1', expected: '原始预期', actualResult: '原始失败详情', result: 'FAILED', remark: '原始备注', artifactIds: ['original-evidence'], bugId: 'original-bug' }],
    }],
  };
}

describe('质量测试报告 HTML', () => {
  it('四类执行结果和未测均明确显示，应测组合数作为两项比例的分母', () => {
    const html = renderQualityTestReport(snapshot());
    expect(html).toContain('应测 5 · 通过 1 · 失败 1 · 阻塞 1 · 跳过 1 · 未测 1');
    expect(html).toContain('执行完成率 80.0% · 通过率 20.0%');
    expect(html).toContain('两项均以应测的用例与目标端组合数为分母，未测不计为通过');
  });
  it('阶段报告明确未完成，最终报告与零范围不适用比例分别显示', () => {
    const report = snapshot();
    expect(renderQualityTestReport(report)).toContain('阶段报告 · 未完成');
    report.mode = 'FINAL';
    report.summary = summarizeQualityResults([]);
    const html = renderQualityTestReport(report);
    expect(html).toContain('最终报告');
    expect(html).not.toContain('阶段报告 · 未完成');
    expect(html).toContain('执行完成率 不适用 · 通过率 不适用');
  });
  it('回归通过不会从报告中删除原失败、旧代码、缺陷和证据引用', () => {
    const report = snapshot();
    report.summary = summarizeQualityResults(['PASSED']);
    report.effectiveCaseIds = ['new-case'];
    report.runs.push({ ...report.runs[0], id: 'regression', name: '修复回归', runType: 'REGRESSION', status: 'PASSED', cases: [{ ...report.runs[0].cases[0], id: 'new-case', result: 'PASSED', actualResult: '修复后通过', artifactIds: ['regression-evidence'] }] });
    const before = structuredClone(report);
    const html = renderQualityTestReport(report);
    for (const fact of ['结论：通过', '原始失败轮次', '原始失败详情', '原始备注', 'old-sha', 'fixed-sha', 'original-bug', 'original-evidence', 'regression-evidence', '回归替代范围', 'old-case']) expect(html).toContain(fact);
    expect(html).toContain('href="/quality/test-runs/old-run"');
    expect(html).toContain('href="/quality/test-runs/regression"');
    expect(report).toEqual(before);
  });
  it('所有动态文字和 JSON 均转义 HTML，证据入口安全编码轮次 ID', () => {
    const attack = '<script>alert("x" & \'y\')</script>';
    const report = snapshot();
    report.request = { id: attack, title: attack, project: attack, version: attack, requirements: [{ id: attack, title: attack }] };
    report.generatedAt = attack;
    report.baseline = [{ headSha: attack }];
    report.supersessions = [{ previousRunId: attack }];
    report.runs = [{ id: '"><img src=x onerror=alert(1)>', name: attack, runType: attack, status: attack, targets: { key: attack }, executions: { environment: attack }, cases: [{ id: 'case', title: attack, target: attack, priority: attack, expected: attack, actualResult: attack, result: attack, remark: attack, artifactIds: [attack], bugId: attack }] }];
    const html = renderQualityTestReport(report);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain(attack);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;');
    expect(html).toContain(`href="/quality/test-runs/${encodeURIComponent(report.runs[0].id)}"`);
  });
});
