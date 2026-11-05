// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { ProjectScopeProvider, useProjectScope } from './project-scope-context';
import {
  CURRENT_PROJECT_STORAGE_KEY,
  buildProjectSwitchLocation,
  withCurrentProject,
} from './project-scope';
import { useRememberedSearchFilters, writeStoredListFilterSnapshot } from './utils/list-filter-storage';
import type { Project } from './types';

vi.mock('./api', () => ({
  api: {
    getProjects: vi.fn(),
  },
}));

const project = {
  id: 'project-1',
  name: '灵讯平台',
  workspace: { id: 'workspace-1', name: '研发平台', repositories: [] },
} as Project;

function FilterProbe() {
  useRememberedSearchFilters('workflow-runs', ['workspaceId', 'runType']);
  const location = useLocation();
  return <output data-location>{`${location.pathname}${location.search}`}</output>;
}

function LocationProbe() {
  const location = useLocation();
  const scope = useProjectScope();
  return (
    <>
      <output data-location>{`${location.pathname}${location.search}`}</output>
      <output data-project>{scope.projectId ?? ''}</output>
      <button type="button" onClick={() => scope.setProjectId('project-2')}>切换</button>
    </>
  );
}

describe('project scope', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.getProjects).mockResolvedValue([
      project,
      { ...project, id: 'project-2', name: '接处警' },
    ]);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function renderAt(path: string) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <ProjectScopeProvider>
            <Routes>
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </ProjectScopeProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('把本机当前项目写进项目级列表地址', async () => {
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, 'project-1');
    await renderAt('/requirements?priority=HIGH');
    expect(container.querySelector('[data-location]')?.textContent).toBe('/requirements?priority=HIGH&projectId=project-1');
    expect(container.querySelector('[data-project]')?.textContent).toBe('project-1');
  });

  it('地址栏里的项目优先并写回本机', async () => {
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, 'project-1');
    await renderAt('/dashboard?projectId=project-2');
    expect(window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY)).toBe('project-2');
    expect(container.querySelector('[data-project]')?.textContent).toBe('project-2');
  });

  it('在组织级页面不改地址，切换时进入看板', async () => {
    await renderAt('/projects');
    expect(container.querySelector('[data-location]')?.textContent).toBe('/projects');
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-location]')?.textContent).toBe('/dashboard?projectId=project-2');
  });

  it('项目列表还没返回时，页面已经使用本机项目', async () => {
    vi.mocked(api.getProjects).mockReturnValue(new Promise(() => undefined));
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, 'project-1');
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/bugs']}>
          <ProjectScopeProvider>
            <Routes>
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </ProjectScopeProvider>
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[data-project]')?.textContent).toBe('project-1');
    expect(container.querySelector('[data-location]')?.textContent).toBe('/bugs');
  });

  it('补上当前项目时保留同一项目记住的工作区', async () => {
    writeStoredListFilterSnapshot('workflow-runs', {
      projectId: 'project-1',
      filters: { workspaceId: 'workspace-1', runType: 'BUG_FIX' },
    });
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, 'project-1');
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/workflow-runs']}>
          <ProjectScopeProvider>
            <Routes>
              <Route path="*" element={<FilterProbe />} />
            </Routes>
          </ProjectScopeProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-location]')?.textContent).toBe('/workflow-runs?workspaceId=workspace-1&runType=BUG_FIX&projectId=project-1');
  });

  it('地址栏里的项目不存在时，改用本机仍有效的项目', async () => {
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, 'project-1');
    await renderAt('/requirements?projectId=missing');
    expect(container.querySelector('[data-location]')?.textContent).toBe('/requirements?projectId=project-1');
    expect(window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY)).toBe('project-1');
  });

  it('从详情切换时回到同类列表并清掉版本', () => {
    expect(buildProjectSwitchLocation('/requirements/req-1', '?projectId=project-1', 'project-2'))
      .toBe('/requirements?projectId=project-2');
    expect(buildProjectSwitchLocation('/requirements', '?projectId=project-1&versionId=ver-1&priority=HIGH', 'project-2'))
      .toBe('/requirements?projectId=project-2&priority=HIGH');
    expect(buildProjectSwitchLocation('/issues', '', 'project-2')).toBeNull();
    expect(withCurrentProject('/quality', 'project-1')).toBe('/quality?projectId=project-1');
    expect(withCurrentProject('/projects', 'project-1')).toBe('/projects');
  });
});
