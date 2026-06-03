import type { GeneratePlanOutput } from '../common/types';

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return '<p class="empty">（无）</p>';
  }
  const lis = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<ul>${lis}</ul>`;
}

export function renderPlanHtml(
  output: GeneratePlanOutput,
  meta: { workflowRunId: string; version: number; status: string },
): string {
  const { summary, implementationPlan, filesToModify, newFiles, riskPoints } = output;
  const footerRunId = escapeHtml(meta.workflowRunId);
  const footerStatus = escapeHtml(meta.status);
  const footerVersion = escapeHtml(String(meta.version));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>技术方案</title>
  <style>
    :root { color-scheme: light; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      line-height: 1.6;
      max-width: 52rem;
      margin: 0 auto;
      padding: 1.5rem 1.25rem 3rem;
      color: #1a1a1a;
      background: #fafafa;
    }
    h1 { font-size: 1.5rem; margin: 0 0 1.25rem; border-bottom: 2px solid #2563eb; padding-bottom: 0.5rem; }
    section { margin-bottom: 1.5rem; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem 1.25rem; }
    h2 { font-size: 1rem; margin: 0 0 0.75rem; color: #374151; }
    p { margin: 0; }
    ul { margin: 0; padding-left: 1.25rem; }
    li { margin: 0.25rem 0; }
    .empty { color: #6b7280; font-style: italic; }
    footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #e5e7eb;
      font-size: 0.8125rem;
      color: #6b7280;
    }
    footer dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 0; }
    footer dt { font-weight: 600; }
    footer dd { margin: 0; font-family: ui-monospace, monospace; word-break: break-all; }
  </style>
</head>
<body>
  <h1>技术方案</h1>
  <section>
    <h2>摘要</h2>
    <p>${escapeHtml(summary)}</p>
  </section>
  <section>
    <h2>实施步骤</h2>
    ${renderList(implementationPlan)}
  </section>
  <section>
    <h2>涉及文件</h2>
    ${renderList(filesToModify)}
  </section>
  <section>
    <h2>新增文件</h2>
    ${renderList(newFiles)}
  </section>
  <section>
    <h2>风险点</h2>
    ${renderList(riskPoints)}
  </section>
  <footer>
    <dl>
      <dt>Workflow run</dt>
      <dd>${footerRunId}</dd>
      <dt>Version</dt>
      <dd>${footerVersion}</dd>
      <dt>Status</dt>
      <dd>${footerStatus}</dd>
    </dl>
  </footer>
</body>
</html>`;
}
