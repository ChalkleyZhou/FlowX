// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ConfirmProvider } from '../components/ConfirmDialog';
import { ExecutionSessionDetailPage, ExecutionSessionsPage } from './ExecutionSessionsPage';
import type { ExecutionSessionDetail } from '../types';

vi.mock('../api', () => ({ api: {
  getProjects: vi.fn(), listExecutionSessions: vi.fn(), getExecutionSession: vi.fn(),
  listExecutionSessionEvidence: vi.fn(), listExecutionSessionEvents: vi.fn(),
  requestExecutionCommand: vi.fn(), retryExecutionSession: vi.fn(),
} }));

const row: ExecutionSessionDetail = {
  id: 's1', workflowRunId: 'w1', status: 'RUNNING', executorType: 'LOCAL', sourceTool: 'codex',
  protocolVersion: '1.2', traceId: 't1', createdAt: '2026-09-30T08:00:00Z', updatedAt: '2026-09-30T08:00:00Z',
  health: 'STALE', canControl: true, controlMode: 'COOPERATIVE',
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
  vi.mocked(api.listExecutionSessionEvidence).mockResolvedValue([]);
  vi.mocked(api.listExecutionSessionEvents).mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
async function render(initialPath = '/execution-sessions') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[initialPath]}><ConfirmProvider><Routes>
    <Route path="/execution-sessions" element={<ExecutionSessionsPage />} />
    <Route path="/execution-sessions/:sessionId" element={<ExecutionSessionDetailPage />} />
  </Routes></ConfirmProvider></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
}
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
  expect(button).toBeDefined(); await act(async () => button?.click());
}

it('列表占满内容区，点击任务进入独立详情，返回保留筛选条件', async () => {
  await render('/execution-sessions?status=RUNNING');
  expect(container.textContent).toContain('修复登录');
  expect(container.textContent).toContain('超过 5 分钟无回报');
  expect(container.querySelector('.xl\\:grid-cols-2')).toBeNull();
  await act(async () => (container.querySelector('a[href^="/execution-sessions/s1?"]') as HTMLAnchorElement)?.click());
  expect(container.textContent).toContain('返回运行列表');
  expect(container.textContent).toContain('修复登录');
  const back = container.querySelector('a[href^="/execution-sessions?status=RUNNING"]') as HTMLAnchorElement;
  expect(back).not.toBeNull();
  await act(async () => back.click());
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'RUNNING' }));
});

it('详情中命令失败可用同一幂等键重试', async () => {
  await render('/execution-sessions/s1');
  vi.mocked(api.requestExecutionCommand).mockRejectedValueOnce(new Error('网络暂不可用'));
  await click('请求停止');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('网络暂不可用');
  const first = vi.mocked(api.requestExecutionCommand).mock.calls[0];
  vi.mocked(api.requestExecutionCommand).mockResolvedValueOnce({ id: 'c1' } as never);
  await click('请求停止');
  expect(vi.mocked(api.requestExecutionCommand).mock.calls[1]).toEqual(first);
});

it('重新交接要求先确认旧执行停止，随后打开新会话', async () => {
  await render('/execution-sessions/s1');
  await click('重新交接');
  expect(api.retryExecutionSession).not.toHaveBeenCalled();
  vi.mocked(api.retryExecutionSession).mockResolvedValue({ executionSessionId: 's2', workflowRunId: 'w1' });
  vi.mocked(api.getExecutionSession).mockResolvedValue({ ...row, id: 's2' });
  await click('旧执行已停止，重新交接');
  expect(api.retryExecutionSession).toHaveBeenCalledWith('s1', 'codex');
  expect(api.getExecutionSession).toHaveBeenLastCalledWith('s2');
});

it('列表失败有重试入口，空列表说明从哪里开始', async () => {
  vi.mocked(api.listExecutionSessions).mockRejectedValueOnce(new Error('读取失败'));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('读取失败');
  vi.mocked(api.listExecutionSessions).mockResolvedValueOnce({ items: [], nextCursor: null });
  await click('刷新');
  expect(container.textContent).toContain('暂无执行记录');
  expect(container.textContent).toContain('工作流');
});

it('没有控制权限仍可查看详情，但不能下发命令', async () => {
  vi.mocked(api.getExecutionSession).mockResolvedValue({ ...row, canControl: false });
  await render('/execution-sessions/s1');
  expect(container.textContent).not.toContain('请求停止');
  expect(container.textContent).not.toContain('重新交接');
});

it('证据或事件读取失败时仍保留运行控制', async () => {
  vi.mocked(api.listExecutionSessionEvidence).mockRejectedValueOnce(new Error('证据服务暂不可用'));
  await render('/execution-sessions/s1');
  expect(container.textContent).toContain('修复登录');
  expect(container.textContent).toContain('运行状态已更新，但部分证据或事件暂时无法读取。');
  expect(container.textContent).toContain('请求停止');
});
