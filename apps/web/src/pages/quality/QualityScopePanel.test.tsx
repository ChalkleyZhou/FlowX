// @vitest-environment jsdom
import { pageResult } from './page-result-test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { QualityScopePanel } from './QualityScopePanel';
import type { QualityCaseSelection, TestDesign } from '../../types';

vi.mock('../../api', () => ({
  api: {
    getTestCasesPage: vi.fn(),
    getTestCaseLibraries: vi.fn(),
    getTestCaseModules: vi.fn(),
        addQualityCandidates: vi.fn(),
    updateQualitySelection: vi.fn(),
  },
}));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.getTestCaseLibraries).mockResolvedValue(pageResult([
    {
      id: 'project-library',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      name: '项目库',
      scope: 'PROJECT',
      status: 'ACTIVE',
    },
    {
      id: 'shared-library',
      workspaceId: 'workspace-1',
      name: '共享库',
      scope: 'WORKSPACE',
      status: 'ACTIVE',
    },
  ]));
  vi.mocked(api.getTestCaseModules).mockResolvedValue(pageResult([
    { id: 'auth', libraryId: 'project-library', name: '认证', sortOrder: 0 },
  ]));
  vi.mocked(api.getTestCasesPage).mockResolvedValue(pageResult([
    {
      id: 'case-251',
      libraryId: 'project-library',
      moduleId: 'auth',
      title: '未进入AI输入的用例',
      status: 'ACTIVE',
      version: 1,
      priority: 'P0',
      steps: ['登录'],
      expected: '成功',
    },
  ]));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
it('保留已保存项目库，模块筛选与人工补选实际透传，展示截断统计', async () => {
  const selection: QualityCaseSelection = { libraryIds: ['project-library'] };
  const design = {
    id: 'design-1',
    revision: 2,
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    status: 'WAITING_REVIEW',
    caseSelection: selection,
    candidates: [],
    retrievalSummary: { eligibleCount: 251, matchedCount: 251, suppliedCount: 250, truncated: true },
  } as unknown as TestDesign;
  vi.mocked(api.addQualityCandidates).mockResolvedValue(design);
  const onDesignChange = vi.fn();
  await act(async () =>
    root.render(
      <QualityScopePanel
        workspaceId="workspace-1"
        projectId="project-1"
        design={design}
        onDesignChange={onDesignChange}
      />,
    ),
  );
  expect(container.textContent).toContain('251');
  expect(container.textContent).toContain('250');
  expect(container.textContent).toContain('截断');
  const module = container.querySelector('select[aria-label="筛选用例模块"]') as HTMLSelectElement;
  await act(async () => {
    module.value = 'auth';
    module.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('未进入AI输入的用例');
  await act(async () =>
    (container.querySelector('input[aria-label="补选 未进入AI输入的用例"]') as HTMLInputElement).click(),
  );
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((item) => item.textContent === '人工纳入所选用例')
      ?.click(),
  );
  expect(api.addQualityCandidates).toHaveBeenCalledWith('design-1', {
    revision: 2,
    definitionIds: ['case-251'],
  });
  expect(onDesignChange).toHaveBeenCalledWith(design);
});
it('项目切换后清除旧范围，不会把第一页项目库误当全部范围', async () => {
  const onSelectionChange = vi.fn();
  await act(async () =>
    root.render(
      <QualityScopePanel
        workspaceId="workspace-1"
        projectId="project-1"
        onSelectionChange={onSelectionChange}
      />,
    ),
  );
  vi.mocked(api.getTestCaseLibraries).mockResolvedValue(pageResult([
    {
      id: 'library-2',
      projectId: 'project-2',
      workspaceId: 'workspace-1',
      name: '新项目库',
      scope: 'PROJECT',
      status: 'ACTIVE',
    },
  ]));
  await act(async () =>
    root.render(
      <QualityScopePanel
        workspaceId="workspace-1"
        projectId="project-2"
        onSelectionChange={onSelectionChange}
      />,
    ),
  );
  expect(onSelectionChange).toHaveBeenLastCalledWith({ libraryIds: [] });
  expect(container.textContent).not.toContain('项目库（旧）');
});

it('未保存的新库范围禁止补选，明确要求先保存', async () => {
  vi.mocked(api.getTestCaseModules).mockImplementation(async libraryId => pageResult(libraryId === 'project-library' ? [{ id: 'auth', libraryId, name: '认证', sortOrder: 0 }] : []));
  vi.mocked(api.getTestCasesPage).mockImplementation(async params => pageResult(params.libraryIds?.includes('project-library') ? [{ id: 'case-251', libraryId: 'project-library', moduleId: 'auth', title: '用例', status: 'ACTIVE', version: 1, priority: 'P0', steps: ['登录'], expected: '成功' }] : []));
  const design = {
    id: 'design-1',
    revision: 2,
    status: 'WAITING_REVIEW',
    caseSelection: { libraryIds: ['project-library'] },
    candidates: [],
  } as unknown as TestDesign;
  await act(async () =>
    root.render(<QualityScopePanel workspaceId="workspace-1" projectId="project-1" design={design} />),
  );
  await act(async () =>
    (container.querySelector('input[aria-label="用例库 共享库"]') as HTMLInputElement).click(),
  );
  expect(container.textContent).toContain('选例范围尚未保存');
  const supplement = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === '人工纳入所选用例',
  );
  expect(supplement?.disabled).toBe(true);
  expect(api.addQualityCandidates).not.toHaveBeenCalled();
});

it('补选跨页保留已选ID，搜索和翻页请求服务端', async () => {
  const definition = { id: 'case-1', libraryId: 'project-library', title: '第一页用例', status: 'ACTIVE' as const, version: 1, priority: 'P0' as const, steps: ['登录'], expected: '成功' };
  vi.mocked(api.getTestCasesPage).mockImplementation(async query => pageResult([{ ...definition, id: query.page === 2 ? 'case-2' : 'case-1', title: query.page === 2 ? '第二页用例' : '第一页用例' }], { total: 21, totalPages: 2, page: query.page ?? 1 }));
  const design = { id: 'design-1', revision: 2, status: 'WAITING_REVIEW', caseSelection: { libraryIds: ['project-library'] }, candidates: [] } as unknown as TestDesign;
  vi.mocked(api.addQualityCandidates).mockResolvedValue(design);
  await act(async () => root.render(<QualityScopePanel workspaceId="workspace-1" projectId="project-1" design={design} />));
  await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="补选 第一页用例"]')?.click());
  const next = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '下一页' && !button.disabled);
  await act(async () => next?.click());
  expect(api.getTestCasesPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 20, libraryIds: ['project-library'] }));
  await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="补选 第二页用例"]')?.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '人工纳入所选用例')?.click());
  expect(api.addQualityCandidates).toHaveBeenCalledWith('design-1', { revision: 2, definitionIds: ['case-1', 'case-2'] });
});
