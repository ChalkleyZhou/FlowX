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

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.getTestRequestScopeDraft).mockResolvedValue(draft);
  vi.mocked(api.getTestCaseLibraries).mockResolvedValue({ items: [{ id: 'library-project', workspaceId: 'workspace-1', projectId: 'project-1', scope: 'PROJECT', name: '项目库', status: 'ACTIVE' }], total: 1, page: 1, pageSize: 100, totalPages: 1 });
  vi.mocked(api.getTestCaseModules).mockResolvedValue({ items: [{ id: 'module-auth', libraryId: 'library-project', parentId: null, name: '账号登录', sortOrder: 0 }], total: 1, page: 1, pageSize: 100, totalPages: 1 });
  vi.mocked(api.getTestCasesPage).mockResolvedValue({ items: [{ id: 'case-extra', libraryId: 'library-project', moduleId: 'module-auth', title: '退出登录', priority: 'P1', status: 'ACTIVE', version: 1, steps: ['点击退出'], expected: '返回登录页' }], total: 1, page: 1, pageSize: 100, totalPages: 1, summary: { p0Count: 0, linkedCount: 0 } });
  vi.mocked(api.updateTestRequestScopeDraft).mockResolvedValue(request);
  vi.mocked(api.addTestRequestScopeDraftCases).mockResolvedValue(request);
  vi.mocked(api.prepareTestRequest).mockResolvedValue({ ...request, status: 'READY' } as TestRequest);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

it('默认把 AI 结果勾选到单列表且列表不展示测试用例详情', async () => {
  await act(async () => root.render(<QualityScopeDraftPanel request={request} onConfirmed={vi.fn()} />));

  expect(container.textContent).toContain('AI 提测范围');
  expect(container.textContent).toContain('全部');
  expect(container.textContent).toContain('已选');
  expect(container.textContent).toContain('AI 推荐');
  expect(container.textContent).toContain('登录后返回首页');
  expect(container.textContent).toContain('验证码错误提示');
  expect(container.textContent).toContain('AI 新用例');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="选择范围用例 登录后返回首页"]')?.checked).toBe(true);
  expect(container.textContent).not.toContain('输入账号');
  expect(container.textContent).not.toContain('跳转首页');
  expect(container.textContent).not.toContain('覆盖登录回归');
});

it('切换已选筛选不会丢失 AI 默认范围，点击列表行可以查看详情', async () => {
  await act(async () => root.render(<QualityScopeDraftPanel request={request} onConfirmed={vi.fn()} />));

  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '已选')?.click());
  expect(container.textContent).toContain('登录后返回首页');
  expect(container.textContent).not.toContain('退出登录');

  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="查看用例 登录后返回首页"]')?.click());
  expect(container.textContent).toContain('输入账号');
  expect(container.textContent).toContain('跳转首页');
});

it('可以从左侧树选择正式用例并直接加入范围', async () => {
  await act(async () => root.render(<QualityScopeDraftPanel request={request} onConfirmed={vi.fn()} />));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="展开用例库 项目库"]')?.click());
  await act(async () => await Promise.resolve());
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="展开模块 账号登录"]')?.click());
  await act(async () => await Promise.resolve());
  await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="选择用例 退出登录"]')?.click());

  expect(api.addTestRequestScopeDraftCases).toHaveBeenCalledWith('request-1', {
    selections: [{ caseId: 'case-extra', reason: '人工补充提测范围', impactLevel: 'MEDIUM' }],
  });
});

it('取消勾选即可移出 AI 用例并整体确认范围', async () => {
  const onConfirmed = vi.fn();
  await act(async () => root.render(<QualityScopeDraftPanel request={request} onConfirmed={onConfirmed} />));
  await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="选择范围用例 登录后返回首页"]')?.click());
  await act(async () => await Promise.resolve());
  expect(api.updateTestRequestScopeDraft).toHaveBeenCalledWith('request-1', { scopeRevision: 4, removedCandidateIds: ['candidate-1'] });

  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('确认范围并进入分派'))?.click());
  expect(api.prepareTestRequest).toHaveBeenCalledWith('request-1', { scopeRevision: 4 });
  expect(onConfirmed).toHaveBeenCalled();
});
