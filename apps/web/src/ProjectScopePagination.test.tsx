// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { api } from './api';
import { ProjectScopeProvider, useProjectScope } from './project-scope-context';

vi.mock('./api', () => ({ api: { getProjects: vi.fn(), getProject: vi.fn() } }));
function Probe() { const scope = useProjectScope(); return <p>{scope.project?.name ?? '未找到'}</p>; }
it('当前项目按ID读取，不因不在项目第一页就清除', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear();
  vi.mocked(api.getProjects).mockResolvedValue({ items: [], total: 100, page: 1, pageSize: 20, totalPages: 5 });
  vi.mocked(api.getProject).mockResolvedValue({ id: 'outside', name: '页外项目', workspace: { id: 'w1', name: '工作区', repositories: [] } });
  const el = document.createElement('div'); const root = createRoot(el);
  await act(async () => root.render(<MemoryRouter initialEntries={['/requirements?projectId=outside']}><ProjectScopeProvider><Probe /></ProjectScopeProvider></MemoryRouter>));
  expect(api.getProject).toHaveBeenCalledWith('outside');
  expect(api.getProjects).not.toHaveBeenCalled();
  expect(el.textContent).toBe('页外项目');
  await act(async () => root.unmount());
});
