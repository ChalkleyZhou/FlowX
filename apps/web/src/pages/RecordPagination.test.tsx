// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { BugsPage } from './BugsPage';
import { IssuesPage } from './IssuesPage';
import { ProjectsPage } from './ProjectsPage';
import { WorkspacesPage } from './WorkspacesPage';

vi.mock('../api', () => ({ api: { getBugs: vi.fn(), getIssues: vi.fn(), getWorkspaces: vi.fn(), getProjects: vi.fn(), getWorkspaceRepositories: vi.fn() } }));
const toast = { error: vi.fn(), success: vi.fn() };
vi.mock('../components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('../components/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }));
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(api.getWorkspaces).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
  vi.mocked(api.getProjects).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('缺陷翻页向API请求下一页，并使用服务端项目统计', async () => {
  vi.mocked(api.getBugs).mockImplementation(async query => ({
    items: [{ id: `bug-${query?.page}`, title: `第${query?.page}页缺陷`,description:'', status: 'OPEN', severity: 'HIGH', priority: 'HIGH' }],
    total: 41, page: query?.page ?? 1, pageSize: 20, totalPages: 3,
    summary: { total: 41, visible: 41, openCount: 30, criticalCount: 7 },
  }));
  await act(async () => root.render(<MemoryRouter initialEntries={['/bugs?projectId=p1']}><BugsPage /></MemoryRouter>));
  expect(api.getBugs).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p1', page: 1, pageSize: 20 }));
  expect(container.textContent).toContain('共 41 条');
  await act(async () => (Array.from(container.querySelectorAll('button')).find(b => b.textContent === '下一页') as HTMLButtonElement).click());
  expect(api.getBugs).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p1', page: 2, pageSize: 20 }));
  expect(container.textContent).toContain('第2页缺陷'); expect(container.textContent).not.toContain('第1页缺陷');
});

it('问题列表恢复URL第二页，空页删除回退最后有效页', async () => {
  vi.mocked(api.getIssues).mockImplementation(async query => ({
    items: [], total: 1, page: query?.page ?? 1, pageSize: 20, totalPages: 1, summary: { total: 1, visible: 1, openCount: 1, inProgressCount: 0 },
  }));
  await act(async () => root.render(<MemoryRouter initialEntries={['/issues?page=2']}><IssuesPage /></MemoryRouter>));
  expect(api.getIssues).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 20 }));
  expect(api.getIssues).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
});

it('项目列表分页后仍能进入第二页的项目', async () => {
  vi.mocked(api.getProjects).mockImplementation(async query => ({ items: [{ id: `project-${query?.page}`, name: `项目${query?.page}`, workspace: { id: 'w1', name: '工作区', repositories: [] } }], total: 21, page: query?.page ?? 1, pageSize: 20, totalPages: 2 }));
  await act(async () => root.render(<MemoryRouter initialEntries={['/projects?page=2']}><ProjectsPage /></MemoryRouter>));
  expect(api.getProjects).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 20 }));
  expect(container.textContent).toContain('项目2');
});

it('工作区列表和代码库子列表分别查询当前页', async () => {
  vi.mocked(api.getWorkspaces).mockResolvedValue({ items: [{ id: 'w1', name: '研发', repositories: [], _count: { projects: 1, requirements: 1, repositories: 21 } }], total: 1, page: 1, pageSize: 20, totalPages: 1 });
  vi.mocked(api.getWorkspaceRepositories).mockImplementation(async (_id, query) => ({ items: [{ id: `r${query?.page}`, name: `代码库${query?.page}`, url: 'https://example.test/repo', syncStatus: 'READY' }], total: 21, page: query?.page ?? 1, pageSize: 20, totalPages: 2 }));
  await act(async () => root.render(<MemoryRouter><WorkspacesPage /></MemoryRouter>));
  expect(api.getWorkspaceRepositories).toHaveBeenCalledWith('w1', expect.objectContaining({ page: 1, pageSize: 20 }));
  const next = Array.from(container.querySelectorAll('button')).find(b => b.textContent === '下一页' && !b.disabled);
  await act(async () => next?.click());
  expect(api.getWorkspaceRepositories).toHaveBeenLastCalledWith('w1', expect.objectContaining({ page: 2, pageSize: 20 }));
});
