type SubmissionReportInput = {
  run: {
    id: string;
    name: string;
    sourceFingerprint: string | null;
    testPlan: { testRequest: { title: string; projectVersion: { name: string } } };
    targets: Array<{
      id: string;
      key: string;
      name: string;
      required: boolean;
      expectedRevisions: unknown;
      status: string;
    }>;
    cases: Array<{
      id: string;
      targetId: string | null;
      required: boolean;
      blocking: boolean;
      snapshot: { title: string; priority: string; expected: string };
      result: {
        result: string;
        actualResult: string | null;
        remark: string | null;
        evidence: unknown;
      } | null;
    }>;
    executions: Array<{
      id: string;
      status: string;
      claimedByUser: { displayName: string } | null;
      deviceId: string | null;
      testedRevisions: unknown;
      environment: unknown;
      summary: string | null;
      startedAt: Date;
      completedAt: Date | null;
    }>;
  };
  revision: number;
  generatedAt: Date;
};

export function renderSubmissionReport({ run, revision, generatedAt }: SubmissionReportInput) {
  const rows = run.cases
    .map((item) => {
      const target = run.targets.find((candidate) => candidate.id === item.targetId);
      const artifacts = readArtifactIds(item.result?.evidence)
        .map((artifactId) => `<code>${escapeHtml(artifactId)}</code>`)
        .join('<br>');
      return `<tr><td>${escapeHtml(target?.name ?? '-')}</td><td>${escapeHtml(item.snapshot.title)}</td><td>${escapeHtml(item.snapshot.priority)}</td><td>${escapeHtml(item.result?.result ?? 'PENDING')}</td><td>${escapeHtml(item.result?.actualResult ?? '')}</td><td>${escapeHtml(item.result?.remark ?? '')}</td><td>${artifacts || '-'}</td></tr>`;
    })
    .join('');
  const executions = run.executions
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.claimedByUser?.displayName ?? 'Unknown')}</strong> · ${escapeHtml(item.deviceId ?? 'unknown device')} · ${escapeHtml(item.status)} · ${escapeHtml(item.summary ?? '')}<pre>testedRevisions=${escapeHtml(JSON.stringify(item.testedRevisions ?? [], null, 2))}\nenvironment=${escapeHtml(JSON.stringify(item.environment ?? {}, null, 2))}</pre></li>`,
    )
    .join('');
  const revisions = run.targets
    .map(
      (target) =>
        `<li><strong>${escapeHtml(target.name)}</strong> · ${escapeHtml(target.status)}<pre>${escapeHtml(JSON.stringify(target.expectedRevisions, null, 2))}</pre></li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(run.testPlan.testRequest.title)} - 提测报告</title><style>body{font-family:system-ui,sans-serif;max-width:1120px;margin:32px auto;padding:0 20px;color:#17202a}h1{font-size:28px}h2{margin-top:28px;font-size:18px}table{width:100%;border-collapse:collapse}th,td{padding:9px;border:1px solid #d9dee5;text-align:left;vertical-align:top}th{background:#f4f6f8}pre{white-space:pre-wrap}small{color:#5f6b76}</style></head><body><h1>${escapeHtml(run.testPlan.testRequest.title)} 提测报告</h1><p><strong>版本：</strong>${escapeHtml(run.testPlan.testRequest.projectVersion.name)}　<strong>冒烟轮次：</strong>${escapeHtml(run.name)}　<strong>报告版本：</strong>${revision}</p><small>生成时间 ${escapeHtml(generatedAt.toISOString())} · sourceFingerprint ${escapeHtml(run.sourceFingerprint ?? '')}</small><h2>代码版本</h2><ul>${revisions}</ul><h2>执行汇总</h2><ul>${executions || '<li>无执行记录</li>'}</ul><h2>用例结果</h2><table><thead><tr><th>目标端</th><th>用例</th><th>优先级</th><th>结果</th><th>实际结果</th><th>备注</th><th>证据 Artifact</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function readArtifactIds(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const artifactIds = (value as Record<string, unknown>).artifactIds;
  return Array.isArray(artifactIds)
    ? artifactIds.filter((item): item is string => typeof item === 'string')
    : [];
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
