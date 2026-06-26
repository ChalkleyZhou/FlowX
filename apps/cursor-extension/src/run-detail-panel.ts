import type * as vscode from 'vscode';
import type { WorkflowRunDetail } from './flowx-client';
import { buildRunDetailModel, type RunDetailModel } from './run-detail-model';
import type { StageActionRequest } from './run-detail-actions';

type VscodeApi = typeof vscode;

export interface RunDetailPanelDeps {
  getRun(runId: string): Promise<WorkflowRunDetail>;
  dispatch(request: StageActionRequest): Promise<void>;
  promptFeedback(label: string): Promise<string | undefined>;
  showError(message: string): void;
  showInfo(message: string): void;
  onChanged?(): void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 24; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function stageOutputText(run: WorkflowRunDetail, key: string): string {
  const stage = run.stageExecutions
    .filter((item) => item.stage === key)
    .sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0))[0];
  if (!stage || stage.output === undefined || stage.output === null) {
    return '';
  }
  try {
    const text = typeof stage.output === 'string' ? stage.output : JSON.stringify(stage.output, null, 2);
    return text.length > 8000 ? `${text.slice(0, 8000)}\n…(已截断)` : text;
  } catch {
    return '';
  }
}

/** Pure HTML renderer for the run detail webview. Exported for testing. */
export function renderRunDetailHtml(
  run: WorkflowRunDetail,
  model: RunDetailModel,
  options: { nonceValue: string; cspSource: string },
): string {
  const { nonceValue, cspSource } = options;
  const exec = model.execution;
  const claimBanner = exec.claimed
    ? `<div class="banner">本地执行接管中${exec.claimedByUserId ? `（${escapeHtml(exec.claimedByUserId)}）` : ''}</div>`
    : '';

  const stagesHtml = model.timeline
    .map((item) => {
      const actions = item.actions
        .map(
          (action) =>
            `<button class="action${action.danger ? ' danger' : ''}" data-stage="${escapeHtml(item.key)}" data-kind="${escapeHtml(
              action.kind,
            )}" data-needs-feedback="${action.needsFeedback ? '1' : '0'}"${
              action.decision ? ` data-decision="${escapeHtml(action.decision)}"` : ''
            }>${escapeHtml(action.label)}</button>`,
        )
        .join('');
      const output = item.isCurrent ? stageOutputText(run, item.key) : '';
      const outputHtml = output ? `<pre class="output">${escapeHtml(output)}</pre>` : '';
      return `<li class="stage${item.isCurrent ? ' current' : ''}">
        <div class="stage-head">
          <span class="stage-title">${escapeHtml(item.title)}</span>
          <span class="stage-status">${escapeHtml(item.status)}</span>
        </div>
        ${item.statusMessage ? `<div class="stage-msg">${escapeHtml(item.statusMessage)}</div>` : ''}
        ${outputHtml}
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </li>`;
    })
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonceValue}'; script-src 'nonce-${nonceValue}';" />
<style nonce="${nonceValue}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  h1 { font-size: 14px; margin: 0 0 4px; }
  .run-status { font-size: 12px; opacity: 0.8; margin-bottom: 12px; }
  .banner { background: var(--vscode-inputValidation-warningBackground, #5a4b00); padding: 6px 10px; border-radius: 4px; margin-bottom: 12px; font-size: 12px; }
  ul { list-style: none; padding: 0; margin: 0; }
  .stage { border: 1px solid var(--vscode-panel-border, #3334); border-radius: 6px; padding: 10px; margin-bottom: 8px; opacity: 0.7; }
  .stage.current { opacity: 1; border-color: var(--vscode-focusBorder, #007fd4); }
  .stage-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .stage-title { font-weight: 600; font-size: 13px; }
  .stage-status { font-size: 11px; opacity: 0.8; }
  .stage-msg { font-size: 12px; opacity: 0.85; margin-top: 4px; }
  pre.output { max-height: 280px; overflow: auto; background: var(--vscode-textCodeBlock-background, #0002); padding: 8px; border-radius: 4px; font-size: 11px; white-space: pre-wrap; margin: 8px 0 0; }
  .actions { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
  button.action { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  button.action.danger { background: var(--vscode-errorForeground, #c33); color: #fff; }
  .toolbar { margin-bottom: 12px; }
</style>
</head>
<body>
  <h1>${escapeHtml(model.title ?? '工作流')}</h1>
  <div class="run-status">状态：${escapeHtml(model.status)} · run ${escapeHtml(model.runId)}</div>
  ${claimBanner}
  <div class="toolbar"><button class="action" id="refresh">刷新</button></div>
  <ul>${stagesHtml}</ul>
  <script nonce="${nonceValue}">
    const vscodeApi = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => vscodeApi.postMessage({ type: 'refresh' }));
    for (const button of document.querySelectorAll('button.action[data-stage]')) {
      button.addEventListener('click', () => {
        vscodeApi.postMessage({
          type: 'action',
          stageKey: button.getAttribute('data-stage'),
          kind: button.getAttribute('data-kind'),
          decision: button.getAttribute('data-decision') || undefined,
          needsFeedback: button.getAttribute('data-needs-feedback') === '1',
        });
      });
    }
  </script>
</body>
</html>`;
}

const openPanels = new Map<string, vscode.WebviewPanel>();

export function openRunDetailPanel(vscodeApi: VscodeApi, deps: RunDetailPanelDeps, runId: string): void {
  const existing = openPanels.get(runId);
  if (existing) {
    existing.reveal();
    void refresh(vscodeApi, existing, deps, runId);
    return;
  }

  const panel = vscodeApi.window.createWebviewPanel('flowxRunDetail', 'FlowX Run', vscodeApi.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  openPanels.set(runId, panel);
  panel.onDidDispose(() => openPanels.delete(runId));

  panel.webview.onDidReceiveMessage(async (message: { type: string; stageKey?: string; kind?: string; decision?: string; needsFeedback?: boolean }) => {
    try {
      if (message.type === 'refresh') {
        await refresh(vscodeApi, panel, deps, runId);
        return;
      }
      if (message.type === 'action' && message.stageKey && message.kind) {
        let feedback: string | undefined;
        if (message.needsFeedback) {
          feedback = await deps.promptFeedback('请输入修改意见');
          if (!feedback?.trim()) {
            return;
          }
        }
        await deps.dispatch({
          runId,
          stageKey: message.stageKey as StageActionRequest['stageKey'],
          kind: message.kind as StageActionRequest['kind'],
          decision: message.decision,
          feedback,
        });
        deps.showInfo('操作已提交。');
        deps.onChanged?.();
        await refresh(vscodeApi, panel, deps, runId);
      }
    } catch (error) {
      deps.showError(error instanceof Error ? error.message : '操作失败');
    }
  });

  void refresh(vscodeApi, panel, deps, runId);
}

async function refresh(
  vscodeApi: VscodeApi,
  panel: vscode.WebviewPanel,
  deps: RunDetailPanelDeps,
  runId: string,
): Promise<void> {
  try {
    const run = await deps.getRun(runId);
    const model = buildRunDetailModel(run);
    panel.title = `FlowX · ${model.title ?? runId}`;
    panel.webview.html = renderRunDetailHtml(run, model, {
      nonceValue: nonce(),
      cspSource: panel.webview.cspSource,
    });
  } catch (error) {
    deps.showError(error instanceof Error ? error.message : '加载工作流失败');
  }
}
