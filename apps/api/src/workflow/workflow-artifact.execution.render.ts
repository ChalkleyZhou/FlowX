import { escapeHtml } from './workflow-artifact.render';

export interface ExecutionReportRepositoryRow {
  name: string;
  workingBranch: string;
  headSha: string;
  changedFileCount: number;
  pushed: boolean;
  verified: boolean;
}

export function renderExecutionReportHtml(params: {
  workflowRunId: string;
  version: number;
  executor: string;
  patchSummary: string;
  changedFiles: string[];
  repositories: ExecutionReportRepositoryRow[];
  pushed: boolean;
}): string {
  const repoRows = params.repositories
    .map(
      (row) => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td><code>${escapeHtml(row.workingBranch)}</code></td>
      <td><code>${escapeHtml(row.headSha.slice(0, 12))}</code></td>
      <td>${row.changedFileCount}</td>
      <td>${row.pushed ? '是' : '否'}</td>
      <td>${row.verified ? '是' : '—'}</td>
    </tr>`,
    )
    .join('');

  const fileList =
    params.changedFiles.length === 0
      ? '<p class="empty">（无）</p>'
      : `<ul>${params.changedFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('')}</ul>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>执行报告</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; line-height: 1.5; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.1rem; margin-top: 1.5rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
    th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; font-size: 0.9rem; }
    th { background: #f4f4f5; }
    .summary { background: #f8fafc; padding: 1rem; border-radius: 6px; white-space: pre-wrap; }
    footer { margin-top: 2rem; font-size: 0.8rem; color: #666; }
    .empty { color: #666; }
  </style>
</head>
<body>
  <h1>执行开发报告</h1>
  <p>本地执行完成；代码在您的工作分支上提交。</p>
  <h2>改动摘要</h2>
  <div class="summary">${escapeHtml(params.patchSummary)}</div>
  <h2>仓库与提交</h2>
  <table>
    <thead>
      <tr><th>仓库</th><th>工作分支</th><th>HEAD</th><th>变更文件数</th><th>已推送</th><th>远程校验</th></tr>
    </thead>
    <tbody>${repoRows}</tbody>
  </table>
  <h2>变更文件</h2>
  ${fileList}
  <footer>
    Workflow ${escapeHtml(params.workflowRunId)} · v${escapeHtml(String(params.version))} · ${escapeHtml(params.executor)} · pushed=${params.pushed ? 'yes' : 'no'}
  </footer>
</body>
</html>`;
}
