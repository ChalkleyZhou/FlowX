// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkflowCollaborationPanel } from './WorkflowCollaborationPanel';
import { api } from '../api';
import type { WorkflowCollaborationSession } from '../utils/workflow-collaboration';

vi.mock('../api', () => ({ api: { getWorkflowCollaboration: vi.fn(), releaseWorkflowLocalTask: vi.fn() } }));
let container: HTMLDivElement;
let root: Root;
let onReleased: ReturnType<typeof vi.fn>;
const session = (overrides: Partial<WorkflowCollaborationSession> = {}): WorkflowCollaborationSession => ({
  id: 'session-1', stageExecutionId: 'stage-1', stage: 'DESIGN', status: 'RUNNING', sourceTool: 'opendesign',
  health: 'UNKNOWN', controlMode: 'NONE', claimedByUser: { displayName: '产品同学 A' }, isOwner: false,
  canRelease: false, lastHeartbeatAt: null, deviceId: null, summary: null, blockedReason: null, errorMessage: null,
  ...overrides,
});
async function render(sessions: WorkflowCollaborationSession[] = [], options: { id?: string; status?: string; stageStatus?: string } = {}) {
  const id = options.id ?? 'workflow-1';
  vi.mocked(api.getWorkflowCollaboration).mockResolvedValue({ workflowRunId: id, currentStage: 'DESIGN', sessions });
  await act(async () => {
    root.render(<WorkflowCollaborationPanel workflowRunId={id} workflowStatus={options.status ?? 'DESIGN_PENDING'} currentStage="DESIGN" currentStageLabel="设计方案" stageExecutionId="stage-1" stageStatus={options.stageStatus ?? 'RUNNING'} onReleased={onReleased} />);
  });
}
async function click(label: string) {
  await act(async () => { Array.from(document.body.querySelectorAll('button')).find(node => node.textContent === label)?.click(); });
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  onReleased = vi.fn(); vi.clearAllMocks();
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); });

it('distinguishes a claimed task from a confirmed running local process and respects permissions', async () => {
  await render([session()]);
  expect(container.textContent).toContain('已领取，待本地回报');
  expect(container.textContent).toContain('尚未确认本地运行状态');
  expect(container.textContent).toContain('产品同学 A');
  expect(container.textContent).toContain('本地设备');
  expect(container.textContent).not.toContain('最近收到本地回报');
  expect(container.textContent).not.toContain('结束本次本地任务');
});

it('does not interpret legacy heartbeat as cooperative health', async () => {
  await render([session({ health: 'ONLINE', lastHeartbeatAt: '2026-10-22T00:00:00Z' })]);
  expect(container.textContent).toContain('尚未确认本地运行状态');
  expect(container.textContent).not.toContain('最近收到本地回报');
});

it('shows cooperative feedback and stale health without treating it as stopped', async () => {
  await render([session({ health: 'ONLINE', controlMode: 'COOPERATIVE', lastHeartbeatAt: '2026-10-22T00:00:00Z', deviceId: 'mac-a' })]);
  expect(container.textContent).toContain('最近收到本地回报');
  expect(container.textContent).toContain('mac-a');
  await render([session({ health: 'STALE', controlMode: 'COOPERATIVE' })]);
  await click('刷新协作状态');
  expect(container.textContent).toContain('长时间未回报');
  expect(container.textContent).toContain('失联不代表本地已停止');
});

it('shows received artifacts as awaiting platform confirmation and explains the next stage', async () => {
  await render([session({ status: 'COMPLETED', health: 'TERMINAL' })], { stageStatus: 'WAITING_CONFIRMATION', status: 'DESIGN_WAITING_CONFIRMATION' });
  expect(container.textContent).toContain('已回传，待平台确认');
  expect(container.textContent).toContain('确认后进入 Spec & Plan');
  expect(container.textContent).not.toContain('继续在本地生成');
});

it('shows failure details and missing ownership honestly', async () => {
  await render([session({ claimedByUser: null, status: 'FAILED', errorMessage: '本地生成失败' })]);
  expect(container.textContent).toContain('未记录执行人');
  expect(container.textContent).toContain('本地生成失败');
});

it('requires stopping confirmation and a reason before explicitly releasing a task', async () => {
  await render([session({ canRelease: true, isOwner: true })]);
  await click('结束本次本地任务');
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain('不能远程关闭 IDE');
  const submit = Array.from(dialog?.querySelectorAll('button') ?? []).find(node => node.textContent === '结束任务并重新交接');
  expect(submit?.disabled).toBe(true);
  await act(async () => {
    const checkbox = dialog?.querySelector<HTMLInputElement>('input[type="checkbox"]'); checkbox?.click();
    const textarea = dialog?.querySelector('textarea');
    if (textarea) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, '原设备任务已停止，转交设计同学');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  expect(submit?.disabled).toBe(false);
  await click('结束任务并重新交接');
  expect(api.releaseWorkflowLocalTask).toHaveBeenCalledWith('workflow-1', { executionSessionId: 'session-1', confirmedStopped: true, reason: '原设备任务已停止，转交设计同学' });
  expect(onReleased).toHaveBeenCalledOnce();
});

it('preserves content during polling, avoids overlap and stops polling at terminal workflow status', async () => {
  vi.useFakeTimers();
  await render([session()]);
  let resolvePending!: (value: { workflowRunId: string; currentStage: string; sessions: WorkflowCollaborationSession[] }) => void;
  vi.mocked(api.getWorkflowCollaboration).mockImplementationOnce(() => new Promise(resolve => { resolvePending = resolve; }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(container.textContent).toContain('产品同学 A');
  expect(api.getWorkflowCollaboration).toHaveBeenCalledTimes(2);
  await act(async () => { resolvePending({ workflowRunId: 'workflow-1', currentStage: 'DESIGN', sessions: [session()] }); });
  await render([session()], { status: 'DONE', stageStatus: 'COMPLETED' });
  const calls = vi.mocked(api.getWorkflowCollaboration).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(api.getWorkflowCollaboration).toHaveBeenCalledTimes(calls);
});

it('keeps a snapshot on background failure and exposes a retry', async () => {
  vi.useFakeTimers();
  await render([session()]);
  vi.mocked(api.getWorkflowCollaboration).mockRejectedValueOnce(new Error('会话读取失败'));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(container.textContent).toContain('产品同学 A');
  expect(container.textContent).toContain('会话读取失败');
  await click('重试协作状态');
  expect(container.textContent).not.toContain('会话读取失败');
});

it('does not show old attempts as the current local task', async () => {
  await render([session({ stageExecutionId: 'old-stage', status: 'RUNNING' })], { stageStatus: 'PENDING' });
  expect(container.textContent).toContain('待执行');
  expect(container.textContent).not.toContain('产品同学 A');
});

it('ignores a late collaboration snapshot from the previous workflow', async () => {
  await render([session()]);
  let finishOld!: (value: { workflowRunId: string; currentStage: string; sessions: WorkflowCollaborationSession[] }) => void;
  vi.mocked(api.getWorkflowCollaboration).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  await act(async () => { Array.from(container.querySelectorAll('button')).find(node => node.textContent === '刷新协作状态')?.click(); });
  await render([session({ claimedByUser: { displayName: '新工作流执行人' } })], { id: 'workflow-2' });
  await act(async () => { finishOld({ workflowRunId: 'workflow-1', currentStage: 'DESIGN', sessions: [session()] }); });
  expect(container.textContent).toContain('新工作流执行人');
  expect(container.textContent).not.toContain('产品同学 A');
});

it('preserves the release confirmation and reason when the release request fails', async () => {
  await render([session({ canRelease: true, isOwner: true })]);
  await click('结束本次本地任务');
  const dialog = document.querySelector('[role="dialog"]');
  await act(async () => {
    dialog?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    const textarea = dialog?.querySelector('textarea');
    if (textarea) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, '原设备已确认停止');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  vi.mocked(api.releaseWorkflowLocalTask).mockRejectedValueOnce(new Error('结束任务失败，请重试'));
  await click('结束任务并重新交接');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('结束任务失败，请重试');
  expect(dialog?.querySelector('textarea')?.value).toBe('原设备已确认停止');
  expect(onReleased).not.toHaveBeenCalled();
  await click('结束任务并重新交接');
  expect(onReleased).toHaveBeenCalledOnce();
});

it('does not claim a running stage is a confirmed cloud or local process without a session snapshot', async () => {
  await render([]);
  expect(container.textContent).toContain('执行位置待确认');
  expect(container.textContent).not.toContain('平台处理中');
});

it('honors the server release permission on a failed workflow without restarting polling', async () => {
  await render([session({ canRelease: true })], { status: 'FAILED', stageStatus: 'FAILED' });
  expect(container.textContent).toContain('结束本次本地任务');
});

it('describes terminal workflows without asking the user to start again', async () => {
  await render([], { status: 'DONE', stageStatus: 'COMPLETED' });
  expect(container.textContent).toContain('工作流已完成，可查看产物');
  expect(container.textContent).not.toContain('请从下方当前阶段操作开始');
});

it('shows pending human confirmation even if the stage record has not arrived', async () => {
  await render([], { status: 'HUMAN_REVIEW_PENDING', stageStatus: 'PENDING' });
  expect(container.textContent).toContain('待人工评审');
  expect(container.textContent).toContain('请查看下方产物');
});
