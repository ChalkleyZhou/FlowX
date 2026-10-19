// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ExecutionSessionDetailPage, ExecutionSessionsPage } from './ExecutionSessionsPage';
import type { ExecutionSessionDetail, ExecutionSessionEvidence, ExecutionSessionSyncEvent } from '../types';

vi.mock('../api', () => ({ api: {
  getProjects: vi.fn(), getOrganizationMembers: vi.fn(), listExecutionSessions: vi.fn(), getExecutionSession: vi.fn(),
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.mocked(api.getProjects).mockResolvedValue([]);
  vi.mocked(api.getOrganizationMembers).mockResolvedValue([{ id: 'u1', displayName: '张三' }]);
  vi.mocked(api.listExecutionSessions).mockImplementation(async (params) => ({
    items: [row], nextCursor: null, total: 41, page: params?.page ?? 1, pageSize: 20, totalPages: 3,
    counts: { active: 41, attention: 8, completed: 17, all: 60 },
  }));
  vi.mocked(api.getExecutionSession).mockResolvedValue(row);
  vi.mocked(api.listExecutionSessionEvidence).mockResolvedValue([]);
  vi.mocked(api.listExecutionSessionEvents).mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); document.body.innerHTML = ''; });
async function render(initialPath = '/execution-sessions') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[initialPath]}><Routes>
    <Route path="/execution-sessions" element={<ExecutionSessionsPage />} />
    <Route path="/dashboard" element={<ExecutionSessionsPage />} />
    <Route path="/execution-sessions/:sessionId" element={<ExecutionSessionDetailPage />} />
  </Routes></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
}
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === text || item.textContent?.trim() === text);
  expect(button).toBeDefined(); await act(async () => button?.click());
}

it('默认查看进行中的开发，未知进度不以心跳代替', async () => {
  await render();
  expect(container.textContent).toContain('研发看板');
  expect(container.querySelector('[aria-label="进行中"]')?.textContent).toContain('41');
  expect(container.querySelector('[aria-label="需关注"]')?.textContent).toContain('8');
  expect(container.querySelector('[aria-label="已完成"]')?.textContent).toContain('17');
  expect(container.querySelector('[aria-label="全部"]')?.textContent).toContain('60');
  expect(container.textContent).toContain('暂无进度回报');
  expect(container.textContent).toContain('超过 5 分钟无回报');
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'active', page: 1, take: 20 }));
  expect(container.textContent).not.toContain('请求停止');
});

it('页码切换、详情与返回保留项目、执行人、工具、搜索和状态筛选', async () => {
  await render('/execution-sessions?view=all&status=RUNNING&projectId=p1&claimedByUserId=u1&sourceTool=codex&search=登录&page=2');
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, claimedByUserId: 'u1', search: '登录', projectId: 'p1' }));
  expect(container.textContent).toContain('共 41 条');
  await click('上一页');
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: 'RUNNING' }));
  await click('下一页');
  await act(async () => (container.querySelector('a[href^="/execution-sessions/s1?"]') as HTMLAnchorElement).click());
  const back = container.querySelector('a[href^="/dashboard?"]') as HTMLAnchorElement;
  expect(back).not.toBeNull();
  expect(back.search).toContain('page=2');
  await act(async () => back.click());
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, view: 'all', sourceTool: 'codex', search: '登录' }));
});

it('切换快捷视图和执行人后回到第一页', async () => {
  await render('/execution-sessions?page=3&projectId=p1');
  await click('需关注');
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'attention', page: 1, projectId: 'p1' }));
  const trigger = container.querySelector('[aria-label="按执行人筛选"]') as HTMLElement;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((item) => item.textContent === '张三') as HTMLElement;
  expect(option).toBeDefined();
  await act(async () => option.click());
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ claimedByUserId: 'u1', page: 1 }));
});

it('按需求名称搜索会重置页码并保留其他筛选', async () => {
  await render('/execution-sessions?page=2&sourceTool=codex');
  const input = container.querySelector('input[aria-label="搜索需求名称"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, ' 登录 ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('搜索');
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: '登录', sourceTool: 'codex' }));
});

it('展示实际进度、项目和测试证据，阻塞直接展示原因', async () => {
  vi.mocked(api.listExecutionSessions).mockResolvedValue({ items: [{ ...row, status: 'BLOCKED',
    blockedReason: '等待接口确认', project: { name: '客户平台' },
    syncEvents: [{ id: 'event-1', eventType: 'execution.progressed', payload: { summary: '正在执行回归测试' }, occurredAt: row.createdAt } as never],
    evidence: [{ id: 'e1', evidenceType: 'TEST_RESULT', title: '回归测试', summary: '18/20 通过' } as never],
  }], nextCursor: null, total: 1, page: 1, pageSize: 20, totalPages: 1 });
  await render();
  for (const content of ['等待接口确认', '客户平台', '正在执行回归测试', '18/20 通过']) expect(container.textContent).toContain(content);
});

it('静默刷新保留页码和已有内容，失败后仍可查看和重试', async () => {
  vi.useFakeTimers();
  await render('/execution-sessions?page=2');
  vi.mocked(api.listExecutionSessions).mockRejectedValueOnce(new Error('读取失败'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(container.textContent).toContain('修复登录');
  expect(container.textContent).not.toContain('正在读取运行记录');
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('读取失败');
  await click('重试');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('首屏失败可重试，无匹配记录可清除筛选', async () => {
  vi.mocked(api.listExecutionSessions).mockRejectedValueOnce(new Error('读取失败'));
  await render('/execution-sessions?search=不存在');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('读取失败');
  vi.mocked(api.listExecutionSessions).mockResolvedValueOnce({ items: [], nextCursor: null, total: 0, page: 1, pageSize: 20, totalPages: 1 });
  await click('重试');
  expect(container.textContent).toContain('没有匹配的开发任务');
  await click('清除筛选');
  expect(api.listExecutionSessions).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, page: 1 }));
});

it('独立详情用于查看，证据读取失败仍保留状态和工作流入口', async () => {
  vi.mocked(api.listExecutionSessionEvidence).mockRejectedValueOnce(new Error('证据服务暂不可用'));
  await render('/execution-sessions/s1');
  expect(container.textContent).toContain('修复登录');
  expect(container.textContent).toContain('当前进展已更新，但部分开发结果或进展记录暂时无法读取。');
  expect(container.querySelector('[aria-label="开发结果"]')?.textContent).toContain('开发结果暂时无法读取，请刷新重试。');
  expect(container.textContent).not.toContain('任务仍在进行中，提交、测试和构建结果会在本地回传后显示。');
  expect(container.textContent).toContain('打开工作流');
  expect(container.textContent).not.toContain('请求停止');
  expect(container.textContent).not.toContain('重新交接');
});

it('详情的进度不会被最近心跳挤掉，并且不提供指向自身的查看链接', async () => {
  vi.mocked(api.getExecutionSession).mockResolvedValue({ ...row,
    latestProgress: { eventType: 'execution.progressed', payload: { summary: '正在运行回归测试' }, occurredAt: row.createdAt },
  } as never);
  await render('/execution-sessions/s1');
  expect(container.textContent).toContain('正在运行回归测试');
  expect(container.querySelector('a[href="/execution-sessions/s1"]')).toBeNull();
});

function reportedResult(evidenceType: ExecutionSessionEvidence['evidenceType'], overrides: Partial<ExecutionSessionEvidence> = {}): ExecutionSessionEvidence {
  return { id: evidenceType, executionSessionId: row.id, evidenceType, sourceTool: 'codex', title: evidenceType,
    status: 'REPORTED', occurredAt: row.createdAt, createdAt: row.createdAt, updatedAt: row.createdAt, ...overrides };
}
function progressEvent(id: string, eventType: string, summary: string, occurredAt = row.createdAt): ExecutionSessionSyncEvent {
  return { id, eventId: id, executionSessionId: row.id, schemaVersion: '1.2', eventType, sourceTool: 'codex',
    traceId: 'trace', occurredAt, receivedAt: occurredAt, idempotencyKey: id, payload: { summary } };
}

it('进展详情展示实质进展记录，心跳不进入记录，技术信息默认折叠', async () => {
  const latest = progressEvent('p1', 'execution.progressed', '已完成接口联调，正在执行回归测试');
  vi.mocked(api.getExecutionSession).mockResolvedValue({ ...row, deviceId: 'device-1', latestProgress: latest });
  vi.mocked(api.listExecutionSessionEvents).mockResolvedValue({ items: [
    progressEvent('h1', 'execution.heartbeat', '仅保活，不代表进度'),
    latest,
    progressEvent('p0', 'execution.started', '已开始处理登录问题', '2026-09-30T07:00:00Z'),
  ], nextCursor: null });
  await render('/execution-sessions/s1');
  expect(api.listExecutionSessionEvents).toHaveBeenLastCalledWith('s1', { view: 'progress', take: 10 });
  const timeline = container.querySelector('[aria-label="最近进展"]');
  expect(timeline?.textContent).toContain('已完成接口联调，正在执行回归测试');
  expect(timeline?.textContent).toContain('已开始处理登录问题');
  expect(timeline?.querySelectorAll('time')).toHaveLength(2);
  expect(container.textContent).not.toContain('仅保活，不代表进度');
  expect(container.textContent).not.toContain('完成证据');
  expect(container.textContent).not.toContain('运行状态');
  const technical = container.querySelector('details');
  expect(technical?.querySelector('summary')?.textContent).toContain('技术信息');
  expect(technical?.open).toBe(false);
  expect(technical?.textContent).toContain('device-1');
});

it('开发结果分类展示提交、文件、测试与构建，明确回报和核验状态', async () => {
  vi.mocked(api.listExecutionSessionEvidence).mockResolvedValue([
    reportedResult('GIT_COMMIT', { title: 'web commit abc123', metadata: { workingBranch: 'codex/login', headSha: 'abc123', pushed: false } }),
    reportedResult('CHANGED_FILES', { metadata: { changedFiles: ['src/login.ts', 'src/login.test.ts'] } }),
    reportedResult('TEST_RESULT', { title: 'Local execution test result', summary: '18/20 通过，登录续期失败' }),
    reportedResult('BUILD_RESULT', { status: 'VERIFIED', summary: '构建通过' }),
    reportedResult('USER_CONFIRMATION', { status: 'REJECTED', summary: '尚未满足验收要求' }),
  ]);
  await render('/execution-sessions/s1');
  const results = container.querySelector('[aria-label="开发结果"]');
  for (const text of ['代码提交', '变更文件', '测试结果', '构建结果', '人工确认', '本地回报', '已核验', '核验未通过',
    'codex/login', 'abc123', '尚未推送', 'src/login.ts', '18/20 通过，登录续期失败', '构建通过']) {
    expect(results?.textContent).toContain(text);
  }
  expect(results?.textContent).toContain('核验状态不代表测试是否通过');
  expect(results?.textContent).not.toContain('Local execution test result');
  expect(results?.textContent).not.toContain('全部通过');
});

it('没有回传结果时按任务状态解释，缺少进展明确提示未知', async () => {
  await render('/execution-sessions/s1');
  expect(container.textContent).toContain('任务仍在进行中，提交、测试和构建结果会在本地回传后显示。');
  expect(container.querySelector('[aria-label="最近进展"]')?.textContent).toContain('尚未收到具体进展记录');
  vi.mocked(api.getExecutionSession).mockResolvedValue({ ...row, status: 'COMPLETED' });
  await click('刷新');
  expect(container.textContent).toContain('任务已结束，尚未收到开发结果，请到对应工作流查看产出或在本地确认回传情况。');
});

it('最近同步都是心跳时仍保留独立获取的最近进展正文', async () => {
  vi.mocked(api.getExecutionSession).mockResolvedValue({ ...row,
    latestProgress: progressEvent('older', 'execution.progressed', '已修复权限校验'),
  });
  vi.mocked(api.listExecutionSessionEvents).mockResolvedValue({ items: [progressEvent('h1', 'execution.heartbeat', '仅保活')], nextCursor: null });
  await render('/execution-sessions/s1');
  expect(container.querySelector('[aria-label="最近进展"]')?.textContent).toContain('已修复权限校验');
});

it('详情静默刷新失败保留已有进展和开发结果，并可主动刷新恢复', async () => {
  vi.useFakeTimers();
  vi.mocked(api.listExecutionSessionEvidence).mockResolvedValue([reportedResult('TEST_RESULT', { summary: '接口测试 42/42 通过' })]);
  vi.mocked(api.getExecutionSession).mockResolvedValue({ ...row, latestProgress: progressEvent('p1', 'execution.progressed', '正在检查权限边界') });
  await render('/execution-sessions/s1');
  vi.mocked(api.getExecutionSession).mockRejectedValueOnce(new Error('服务暂时不可用'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('服务暂时不可用');
  expect(container.querySelector('[aria-label="开发结果"]')?.textContent).toContain('接口测试 42/42 通过');
  expect(container.querySelector('[aria-label="最近进展"]')?.textContent).toContain('正在检查权限边界');
  expect(container.textContent).not.toContain('正在读取运行详情');
  await click('刷新');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
