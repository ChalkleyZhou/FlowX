// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { Project } from '../types';
import { ProjectDetailPage } from './ProjectDetailPage';

vi.mock('../api', () => ({ api: { getProject: vi.fn() } }));
vi.mock('../components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../components/ProjectBriefingConfigPanel', () => ({ ProjectBriefingConfigPanel: () => null }));
vi.mock('../components/ProjectCodeReviewConfigPanel', () => ({ ProjectCodeReviewConfigPanel: () => null }));
vi.mock('../components/ProjectVersionsPanel', () => ({ ProjectVersionsPanel: () => <div>版本管理</div> }));

const project: Project = {
  id: 'project-1', name: 'FlowX', workspace: { id: 'ws-1', name: '研发平台', repositories: [] },
  currentVersionId: 'ver-current', currentVersion: { id: 'ver-current', name: '2.6.0' },
  versions: [{ id: 'ver-current', name: '2.6.0' }], requirements: [],
};

describe('项目设置', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(api.getProject).mockResolvedValue(project);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });

  it('展示当前项目的基本信息和版本配置，不再内嵌需求列表', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/project-settings?projectId=project-1']}>
          <Routes>
            <Route path="/project-settings" element={<ProjectDetailPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    expect(api.getProject).toHaveBeenCalledWith('project-1');
    expect(container.textContent).toContain('FlowX');
    expect(container.textContent).toContain('研发平台');
    expect(container.textContent).toContain('版本管理');
    expect(container.textContent).not.toContain('新建需求');
    expect(container.querySelector('a[href="/schedule?projectId=project-1"]')).toBeTruthy();
  });

  it('没有当前项目时提示先选择', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/project-settings']}>
          <ProjectDetailPage />
        </MemoryRouter>,
      );
    });
    expect(container.textContent).toContain('先选择一个项目');
    expect(api.getProject).not.toHaveBeenCalled();
  });
});
