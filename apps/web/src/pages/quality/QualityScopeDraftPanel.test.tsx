// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { QualityScopeDraftPanel } from './QualityScopeDraftPanel';
import type { TestRequest, TestRequestScopeDraft } from '../../types';

vi.mock('../../api', () => ({
  api: {
    getTestRequestScopeDraft: vi.fn(),
    updateTestRequestScopeDraft: vi.fn(),
    addTestRequestScopeDraftCases: vi.fn(),
    prepareTestRequest: vi.fn(),
    getTestCaseLibraries: vi.fn(),
    getTestCaseModules: vi.fn(),
    getTestCasesPage: vi.fn(),
    saveGeneratedTestRequestCase: vi.fn(),
    updateTestRequestScopeModule: vi.fn(),
  },
}));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

const request = {
  id: 'request-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  status: 'DRAFT',
  scopeGenerationStatus: 'COMPLETED',
} as unknown as TestRequest;

const draft: TestRequestScopeDraft = {
  scopeRevision: 4,
  status: 'COMPLETED',
  page: 1,
  pageSize: 50,
  total: 2,
  totalPages: 1,
  summary: { REUSE: 1, CREATE: 1 },
  items: [
    {
      id: 'candidate-1',
      action: 'REUSE',
      resolution: 'PENDING',
      sourceDefinitionId: 'case-existing',
      sourceVersion: 2,
      coverageKeys: ['requirement-1'],
      matchReason: '覆盖登录回归',
      proposedCase: { title: '登录后返回首页', priority: 'P1', steps: ['输入账号'], expected: '跳转首页' },
      sourceDefinition: {
        id: 'case-existing',
        libraryId: 'library-project',
        moduleId: 'module-auth',
        title: '登录后返回首页',
        priority: 'P1',
        status: 'ACTIVE',
        version: 2,
        steps: ['输入账号'],
        expected: '跳转首页',
        library: { id: 'library-project', workspaceId: 'workspace-1', projectId: 'project-1', scope: 'PROJECT', name: '项目库', status: 'ACTIVE' },
        module: { id: 'module-auth', name: '账号登录' },
      },
    },
    {
      id: 'candidate-2',
      action: 'CREATE',
      resolution: 'PENDING',
      coverageKeys: ['requirement-2'],
      matchReason: '新增覆盖',
      proposedCase: { title: '验证码错误提示', priority: 'P2', steps: ['输入错误验证码'], expected: '提示错误' },
      sourceDefinition: null,
    },
  ],
};

let state: TestRequestScopeDraft;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  state = structuredClone(draft);
  vi.mocked(api.getTestRequestScopeDraft).mockImplementation(async (_id, query) => {
    const included = state.items.filter(item => item.action !== 'EXCLUDE' && item.resolution !== 'REJECTED');
    return structuredClone({ ...state, items: query?.view === 'library' ? state.items.filter(item => item.sourceDefinitionId) : included, total: query?.view === 'library' ? 1 : included.length, summary: { included: included.length, matchingIncluded: included.length, available: 1 } });
  });
  vi.mocked(api.getTestCaseLibraries).mockResolvedValue({ items: [{ id: 'library-project', workspaceId: 'workspace-1', projectId: 'project-1', scope: 'PROJECT', name: '项目库', status: 'ACTIVE' }], total: 1, page: 1, pageSize: 100, totalPages: 1 });
  vi.mocked(api.getTestCaseModules).mockResolvedValue({ items: [{ id: 'module-auth', libraryId: 'library-project', parentId: null, name: '账号登录', sortOrder: 0 }], total: 1, page: 1, pageSize: 100, totalPages: 1 });
  vi.mocked(api.getTestCasesPage).mockResolvedValue({ items: [{ id: 'case-extra', libraryId: 'library-project', moduleId: 'module-auth', title: '退出登录', priority: 'P1', status: 'ACTIVE', version: 1, steps: ['点击退出'], expected: '返回登录页' }], total: 1, page: 1, pageSize: 100, totalPages: 1, summary: { p0Count: 0, linkedCount: 0 } });
  vi.mocked(api.updateTestRequestScopeDraft).mockImplementation(async (_id, payload) => {
    for (const item of state.items) {
      if (payload.removedCandidateIds.includes(item.id)) item.resolution = 'REJECTED';
      if (payload.restoredCandidateIds?.includes(item.id)) item.resolution = 'ACCEPTED';
    }
    return { ...request, scopeRevision: ++state.scopeRevision };
  });
  vi.mocked(api.addTestRequestScopeDraftCases).mockResolvedValue(request);
  vi.mocked(api.prepareTestRequest).mockResolvedValue({ ...request, status: 'READY' } as TestRequest);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function button(label: string) { return Array.from(container.querySelectorAll('button')).find(node => node.textContent === label)!; }
function checkbox(title: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="选择范围用例 ${title}"]`)!; }
async function renderPanel() { await act(async () => root.render(<QualityScopeDraftPanel request={request} onConfirmed={vi.fn()} />)); }

it('默认仅展示本次范围，目录不含复选框，列表不展示详情', async () => {
  await renderPanel();
  expect(button('本次范围').getAttribute('aria-pressed')).toBe('true');
  expect(checkbox('登录后返回首页').checked).toBe(true);
  expect(container.querySelector('aside[aria-label="用例目录"] input[type="checkbox"]')).toBeNull();
  expect(container.textContent).not.toContain('输入账号');
  expect(container.textContent).not.toContain('已移除 0');
});

it('取消后立即消失，重读仍保持移除，全部用例未勾选，撤销可恢复', async () => {
  await renderPanel();
  await act(async () => checkbox('登录后返回首页').click());
  expect(checkbox('登录后返回首页')).toBeNull();
  expect(container.textContent).toContain('已选 1 条');
  await act(async () => button('全部用例').click());
  expect(checkbox('登录后返回首页').checked).toBe(false);
  await act(async () => button('撤销').click());
  expect(checkbox('登录后返回首页').checked).toBe(true);
  expect(api.updateTestRequestScopeDraft).toHaveBeenLastCalledWith('request-1', { scopeRevision: 5, removedCandidateIds: [], restoredCandidateIds: ['candidate-1'] });
});

it('AI 新用例可以撤销移除，不需要先保存到用例库', async () => {
  await renderPanel();
  await act(async () => checkbox('验证码错误提示').click());
  await act(async () => button('撤销').click());
  expect(checkbox('验证码错误提示').checked).toBe(true);
  expect(api.saveGeneratedTestRequestCase).not.toHaveBeenCalled();
});

it('写入失败恢复勾选状态，并阻止确认直至重新同步', async () => {
  vi.mocked(api.updateTestRequestScopeDraft).mockRejectedValueOnce(new Error('保存失败'));
  await renderPanel();
  await act(async () => checkbox('登录后返回首页').click());
  expect(checkbox('登录后返回首页').checked).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('保存失败');
  expect(button('确认范围并进入分派').disabled).toBe(true);
  await act(async () => button('重新同步').click());
  expect(button('确认范围并进入分派').disabled).toBe(false);
});

it('快速连续取消按顺序保存最新 revision，不会被旧查询重新选中', async () => {
  let finish!: () => void;
  const original = vi.mocked(api.updateTestRequestScopeDraft).getMockImplementation()!;
  vi.mocked(api.updateTestRequestScopeDraft).mockImplementationOnce(async (...args) => {
    await new Promise<void>(resolve => { finish = resolve; });
    return original(...args);
  });
  await renderPanel();
  await act(async () => { checkbox('登录后返回首页').click(); checkbox('验证码错误提示').click(); });
  expect(container.textContent).toContain('保存中');
  expect(button('确认范围并进入分派').disabled).toBe(true);
  await act(async () => finish());
  expect(api.updateTestRequestScopeDraft).toHaveBeenNthCalledWith(2, 'request-1', { scopeRevision: 5, removedCandidateIds: ['candidate-2'] });
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  expect(container.textContent).toContain('已选 0 条');
});

it('点击标题连续浏览详情，不改变范围和筛选', async () => {
  await renderPanel();
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="查看用例 登录后返回首页"]')!.click());
  expect(container.querySelector('[aria-label="用例详情"]')?.textContent).toContain('输入账号');
  await act(async () => button('下一条').click());
  expect(container.querySelector('[aria-label="用例详情"]')?.textContent).toContain('输入错误验证码');
  expect(api.updateTestRequestScopeDraft).not.toHaveBeenCalled();
  expect(api.saveGeneratedTestRequestCase).not.toHaveBeenCalled();
});

it('模块操作交由服务端覆盖完整模块，包含分页外用例', async () => {
  await renderPanel();
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="展开用例库 项目库"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="筛选模块 账号登录"]')!.click());
  vi.mocked(api.updateTestRequestScopeModule).mockResolvedValue({ ...request, scopeRevision: 5 });
  await act(async () => button('纳入整个模块').click());
  expect(api.updateTestRequestScopeModule).toHaveBeenCalledWith('request-1', { scopeRevision: 4, moduleId: 'module-auth', included: true });
  expect(api.getTestCasesPage).not.toHaveBeenCalled();
});

it('保存后的刷新未返回时继续取消，不中断后续操作', async () => {
  const original = vi.mocked(api.getTestRequestScopeDraft).getMockImplementation()!;
  let release!: () => void;
  vi.mocked(api.getTestRequestScopeDraft).mockImplementationOnce(original).mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    await new Promise<void>(resolve => { release = resolve; });
    return result;
  });
  await renderPanel();
  await act(async () => checkbox('登录后返回首页').click());
  await act(async () => checkbox('验证码错误提示').click());
  await act(async () => release());
  expect(api.updateTestRequestScopeDraft).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain('已选 0 条');
});

it('旧刷新失败不会阻断已经排队的新操作', async () => {
  const original = vi.mocked(api.getTestRequestScopeDraft).getMockImplementation()!;
  let reject!: (reason: Error) => void;
  vi.mocked(api.getTestRequestScopeDraft).mockImplementationOnce(original).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await renderPanel();
  await act(async () => checkbox('登录后返回首页').click());
  await act(async () => checkbox('验证码错误提示').click());
  await act(async () => reject(new Error('旧查询网络断开')));
  expect(api.updateTestRequestScopeDraft).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain('已选 0 条');
});

it('AI 新用例入库刷新后仍能连续浏览详情', async () => {
  await renderPanel();
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="查看用例 验证码错误提示"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="保存目标用例库"]')!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  await act(async () => container.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  vi.mocked(api.saveGeneratedTestRequestCase).mockImplementationOnce(async () => {
    state.items[1].sourceDefinitionId = 'saved-case';
    return { candidateId: 'candidate-2', testCase: { id: 'saved-case' } } as Awaited<ReturnType<typeof api.saveGeneratedTestRequestCase>>;
  });
  await act(async () => button('保存到用例库').click());
  expect(button('上一条').disabled).toBe(false);
  await act(async () => button('上一条').click());
  expect(container.querySelector('[aria-label="用例详情"]')?.textContent).toContain('输入账号');
});

it('切换页面卸载组件后，已经接受的保存仍按顺序完成', async () => {
  const original = vi.mocked(api.updateTestRequestScopeDraft).getMockImplementation()!;
  let release!: () => void;
  vi.mocked(api.updateTestRequestScopeDraft).mockImplementationOnce(async (...args) => {
    await new Promise<void>(resolve => { release = resolve; });
    return original(...args);
  });
  await renderPanel();
  await act(async () => { checkbox('登录后返回首页').click(); checkbox('验证码错误提示').click(); });
  await act(async () => root.render(null));
  await act(async () => release());
  expect(api.updateTestRequestScopeDraft).toHaveBeenCalledTimes(2);
  expect(state.items.every(item => item.resolution === 'REJECTED')).toBe(true);
});

it('已有确认快照时首屏直接只读，不发送范围修改请求', async () => {
  const confirmedRequest = { ...request, testPlan: { id: 'plan-1', status: 'DRAFT', snapshots: [], runs: [], _count: { snapshots: 1, runs: 0 } } } as TestRequest;
  await act(async () => root.render(<QualityScopeDraftPanel request={confirmedRequest} onConfirmed={vi.fn()} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(container.textContent).toContain('范围已确认，仅可查看');
  expect(checkbox('登录后返回首页').disabled).toBe(true);
  expect(button('确认范围并进入分派').disabled).toBe(true);
  expect(api.updateTestRequestScopeDraft).not.toHaveBeenCalled();
});

it('慢网下切出再切回，等待旧保存队列完成后读取真实范围', async () => {
  const original = vi.mocked(api.updateTestRequestScopeDraft).getMockImplementation()!;
  let release!: () => void;
  vi.mocked(api.updateTestRequestScopeDraft).mockImplementationOnce(async (...args) => {
    await new Promise<void>(resolve => { release = resolve; });
    return original(...args);
  });
  await renderPanel();
  await act(async () => { checkbox('登录后返回首页').click(); checkbox('验证码错误提示').click(); });
  await act(async () => root.render(null));
  await renderPanel();
  await act(async () => release());
  expect(container.textContent).toContain('已选 0 条');
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
