// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ConfirmProvider } from '../components/ConfirmDialog';
import { ExecutionSessionsPage } from './ExecutionSessionsPage';
import type { ExecutionSessionDetail } from '../types';

vi.mock('../api', () => ({ api: { getProjects: vi.fn(), listExecutionSessions: vi.fn(), getExecutionSession: vi.fn(), requestExecutionCommand: vi.fn(), retryExecutionSession: vi.fn() } }));
const row: ExecutionSessionDetail = {
  id: 's1', workflowRunId: 'w1', status: 'RUNNING', executorType: 'LOCAL', sourceTool: 'codex', protocolVersion: '1.2', traceId: 't1',
  createdAt: '', updatedAt: '', health: 'STALE', canControl: true, controlMode: 'COOPERATIVE',
  workflowRun: { requirement: { title: '修复登录' } },
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.mocked(api.getProjects).mockResolvedValue([]);
  vi.mocked(api.listExecutionSessions).mockResolvedValue({ items: [row], nextCursor: null });
  vi.mocked(api.getExecutionSession).mockResolvedValue(row);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
async function render() { await act(async () => root.render(<MemoryRouter><ConfirmProvider><ExecutionSessionsPage /></ConfirmProvider></MemoryRouter>)); }
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === text);
  expect(button).toBeDefined(); await act(async () => button?.click());
}

it('展示加载、列表、详情和命令失败；网络失败重试沿用幂等键', async () => {
  let resolveList!: (value: { items: ExecutionSessionDetail[]; nextCursor: null }) => void;
  vi.mocked(api.listExecutionSessions).mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve; }));
  await render(); expect(container.textContent).toContain('正在加载运行记录');
  await act(async () => resolveList({ items: [row], nextCursor: null }));
  expect(container.textContent).toContain('修复登录'); expect(container.textContent).toContain('失联');
  await click('查看运行');
  vi.mocked(api.requestExecutionCommand).mockRejectedValueOnce(new Error('网络暂不可用'));
  await click('请求取消');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('网络暂不可用');
  const first = vi.mocked(api.requestExecutionCommand).mock.calls[0];
  vi.mocked(api.requestExecutionCommand).mockResolvedValueOnce({ id: 'c1' } as never);
  await click('请求取消');
  expect(vi.mocked(api.requestExecutionCommand).mock.calls[1]).toEqual(first);
});

it('列表失败可刷新，空结果显示空态', async () => {
  vi.mocked(api.listExecutionSessions).mockRejectedValueOnce(new Error('读取失败'));
  await render(); expect(container.querySelector('[role="alert"]')?.textContent).toBe('读取失败');
  vi.mocked(api.listExecutionSessions).mockResolvedValueOnce({ items: [], nextCursor: null });
  await click('刷新列表'); expect(container.textContent).toContain('当前筛选下没有执行会话');
});

it('重新交接需要先确认旧执行已停止，返回的新会话随后可见', async () => {
  await render(); await click('查看运行'); await click('重新交接');
  expect(api.retryExecutionSession).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('请先在旧设备确认');
  vi.mocked(api.retryExecutionSession).mockResolvedValue({ executionSessionId: 's2', workflowRunId: 'w1' });
  vi.mocked(api.getExecutionSession).mockResolvedValue({ ...row, id: 's2' });
  await click('旧执行已停止，重新交接');
  expect(api.retryExecutionSession).toHaveBeenCalledWith('s1', 'codex');
  expect(api.getExecutionSession).toHaveBeenLastCalledWith('s2');
});

it('无控制权限时只能查看运行状态', async () => {
  vi.mocked(api.getExecutionSession).mockResolvedValue({ ...row, canControl: false });
  await render(); await click('查看运行');
  expect(container.textContent).not.toContain('请求取消');
  expect(container.textContent).not.toContain('重新交接');
});
