// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkflowCodeDeliveryPanel } from './WorkflowCodeDeliveryPanel';
import { api } from '../api';
import type { WorkflowCodeDelivery } from '../types';

vi.mock('../api', () => ({ api: { getCodeDelivery: vi.fn(), submitCodeBranch: vi.fn(), confirmCodeDelivery: vi.fn() } }));
let container: HTMLDivElement;
let root: Root;
const changed = vi.fn();
const snapshot = (overrides: Partial<WorkflowCodeDelivery> = {}): WorkflowCodeDelivery => ({
  workflowRunId: 'wf-1', canSubmit: true, reason: null, stageExecutionId: 'stage-1',
  repositories: [{ id: 'repo-web', name: 'Web', baseBranch: 'main' }, { id: 'repo-api', name: 'API', baseBranch: 'main' }],
  submissions: [
    { id: 's-1', workflowRepositoryId: 'repo-web', branch: 'feature/web', headSha: 'a'.repeat(40), submittedBy: { id: 'u-a', displayName: '甲' }, updatedAt: '2026-10-22T04:00:00Z' },
    { id: 's-2', workflowRepositoryId: 'repo-web', branch: 'feature/web-other', headSha: 'b'.repeat(40), submittedBy: { id: 'u-b', displayName: '乙' }, updatedAt: '2026-10-22T04:05:00Z' },
  ], confirmedDelivery: null, history: [], ...overrides,
});
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.clearAllMocks(); vi.mocked(api.getCodeDelivery).mockResolvedValue(snapshot());
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); });
async function render(id = 'wf-1') {
  await act(async () => { root.render(<WorkflowCodeDeliveryPanel workflowRunId={id} workflowStatus="EXECUTION_RUNNING" onChanged={changed} />); });
}
async function click(label: string) {
  const button = Array.from(document.body.querySelectorAll('button')).find(node => node.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}

it('展示多人分支与缺少提交的仓库，参与无需领取任务', async () => {
  await render();
  expect(container.textContent).toContain('feature/web');
  expect(container.textContent).toContain('甲');
  expect(container.textContent).toContain('乙');
  expect(container.textContent).toContain('API');
  expect(container.textContent).toContain('尚未提交');
  expect(container.querySelector('input[name="headSha"]')).toBeNull();
  expect(container.textContent).not.toContain('领取任务');
});

it('返工后可只读查看历史分支，不能将旧尝试纳入新交付', async () => {
  vi.mocked(api.getCodeDelivery).mockResolvedValue(snapshot({
    submissions: [], stageExecutionId: null,
    history: [{ stageExecutionId: 'previous-stage', attempt: 1, status: 'FAILED', submissions: snapshot().submissions }],
  }));
  await render();
  expect(container.querySelector('details')?.textContent).toContain('历史分支提交');
  expect(container.querySelector('details')?.textContent).toContain('feature/web-other');
  expect(container.querySelector('details')?.textContent).toContain('第 1 次');
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  expect(Array.from(container.querySelectorAll('button')).find(node => node.textContent === '确认本次交付')?.disabled).toBe(true);
});

it('只传仓库和分支，提交不调用整体完成接口', async () => {
  await render();
  vi.mocked(api.submitCodeBranch).mockResolvedValue(snapshot());
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[name="branch"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'feature/web');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('提交分支');
  expect(api.submitCodeBranch).toHaveBeenCalledWith('wf-1', { workflowRepositoryId: 'repo-web', branch: 'feature/web' });
  expect(api.confirmCodeDelivery).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledOnce();
});

it('同仓只能选定一份最终分支，确认明确展示未覆盖仓库与冻结 SHA', async () => {
  await render();
  const checks = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  await act(async () => checks[0].click());
  await act(async () => checks[1].click());
  expect(checks[0].checked).toBe(false);
  await click('确认本次交付');
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('API');
  expect(dialog.textContent).toContain('未纳入');
  expect(dialog.textContent).toContain('bbbbbbbbbbbb');
  expect(dialog.textContent).not.toContain('aaaaaaaaaaaa');
  vi.mocked(api.confirmCodeDelivery).mockResolvedValue(snapshot({ canSubmit: false }));
  await click('确认并进入审查');
  expect(api.confirmCodeDelivery).toHaveBeenCalledWith('wf-1', { confirmed: true, submissions: [{ id: 's-2', headSha: 'b'.repeat(40) }] });
});

it('Git确认失败保留选择和分支，提供可恢复提示', async () => {
  await render();
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click('确认本次交付');
  vi.mocked(api.confirmCodeDelivery).mockRejectedValueOnce(new Error('分支已有新提交，请重新提交'));
  await click('确认并进入审查');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('分支已有新提交');
  expect(container.textContent).toContain('feature/web');
  expect(changed).not.toHaveBeenCalled();
});

it('读取失败可重试，刷新失败保留已展示分支', async () => {
  vi.mocked(api.getCodeDelivery).mockRejectedValueOnce(new Error('读取失败'));
  await render();
  expect(container.textContent).toContain('读取失败');
  await click('刷新代码交付');
  expect(container.textContent).toContain('feature/web');
  vi.mocked(api.getCodeDelivery).mockRejectedValueOnce(new Error('暂时断开'));
  await click('刷新代码交付');
  expect(container.textContent).toContain('feature/web');
  expect(container.textContent).toContain('暂时断开');
});

it('切换工作流后旧提交回包不能污染新流程', async () => {
  await render();
  let finish!: (value: WorkflowCodeDelivery) => void;
  vi.mocked(api.submitCodeBranch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[name="branch"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'old-branch');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('提交分支');
  vi.mocked(api.getCodeDelivery).mockResolvedValue(snapshot({ workflowRunId: 'wf-2', submissions: [] }));
  await render('wf-2');
  await act(async () => finish(snapshot()));
  expect(container.textContent).not.toContain('feature/web-other');
  expect(changed).not.toHaveBeenCalled();
});
