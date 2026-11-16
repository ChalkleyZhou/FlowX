// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { pageResult } from '../test-utils/page-result';
import { VersionWorkspacePage } from './VersionWorkspacePage';

vi.mock('../api', () => ({
  api: {
    listProjectVersions: vi.fn(),
    getProjectVersion: vi.fn(),
    listVersionWorkItems: vi.fn(),
  },
}));

vi.mock('../project-scope-context', () => ({
  useProjectScopeOptional: () => ({
    projectId: 'project-1',
    project: { id: 'project-1', name: 'FlowX 控制台', currentVersionId: 'version-1' },
  }),
}));

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

describe('VersionWorkspacePage', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.listProjectVersions).mockResolvedValue(pageResult([
      { id: 'version-1', name: '2.6.0' },
      { id: 'version-2', name: '2.7.0' },
    ]));
    vi.mocked(api.getProjectVersion).mockResolvedValue({ id: 'version-1', name: '2.6.0' });
    vi.mocked(api.listVersionWorkItems).mockResolvedValue({ items: [], nextCursor: null });
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('opens the current version work-item board and exposes a version switcher', async () => {
    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/versions?projectId=project-1']}><VersionWorkspacePage /></MemoryRouter>);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('版本工作台');
    expect(container.textContent).toContain('2.6.0');
    expect(container.textContent).toContain('统一查看需求、问题和缺陷');
    const versionTrigger = container.querySelector('button[aria-label="切换版本"]');
    expect(versionTrigger).not.toBeNull();
    expect(versionTrigger?.textContent).toContain('2.6.0');
    expect(api.listVersionWorkItems).toHaveBeenCalledWith('project-1', 'version-1', expect.anything());
  });
});
