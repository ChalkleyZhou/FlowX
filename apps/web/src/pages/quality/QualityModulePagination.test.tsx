// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { QualityModuleManagementDialog } from './QualityModuleManagementDialog';
import { pageResult } from './page-result-test';

vi.mock('../../api', () => ({ api: { getTestCaseLibraries: vi.fn(), getTestCaseModules: vi.fn(), deleteTestCaseModule: vi.fn() } }));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
const libraries = ['A', 'B'].map(id => ({ id, name: `库${id}`, workspaceId: 'ws1', projectId: 'project1', scope: 'PROJECT' as const, status: 'ACTIVE' as const }));
let root: Root; let container: HTMLDivElement; let deleted: boolean;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); deleted = false;
  vi.mocked(api.getTestCaseLibraries).mockResolvedValue(pageResult(libraries));
  vi.mocked(api.getTestCaseModules).mockImplementation(async (libraryId, query) => {
    const page = query?.page ?? 1; const total = libraryId === 'A' ? deleted ? 20 : 21 : 1;
    return pageResult(page > Math.ceil(total / 20) ? [] : [{ id: `${libraryId}-${page}`, libraryId, name: `模块${libraryId}${page}`, sortOrder: 0 }], { page, total, totalPages: Math.ceil(total / 20) });
  });
  vi.mocked(api.deleteTestCaseModule).mockImplementation(async () => { deleted = true; return { id: 'A-2', affectedCases: 0, success: true as const }; });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
async function render() { await act(async () => root.render(<QualityModuleManagementDialog open onOpenChange={vi.fn()} workspaceId="ws1" projectId="project1" libraries={libraries} defaultLibraryId="A" onChanged={async () => undefined} />)); }
async function next() { await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '下一页' && !button.disabled)?.click()); }

it('模块删除末页最后一项后返回前页', async () => {
  await render(); await next();
  expect(document.body.textContent).toContain('模块A2');
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="删除模块：模块A2"]')?.click());
  expect(api.getTestCaseModules).toHaveBeenLastCalledWith('A', { page: 1, pageSize: 20 });
  expect(document.body.textContent).toContain('模块A1');
  expect(document.body.textContent).toContain('第 1 / 1 页');
});
it('从第二页切换到另一用例库从第一页加载', async () => {
  await render(); await next();
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="用例库"]')?.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(button => button.textContent === '库B')?.click());
  expect(api.getTestCaseModules).toHaveBeenLastCalledWith('B', { page: 1, pageSize: 20 });
  expect(document.body.textContent).toContain('模块B1');
  expect(document.body.textContent).toContain('第 1 / 1 页');
});
