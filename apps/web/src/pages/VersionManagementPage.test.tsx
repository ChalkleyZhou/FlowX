// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { pageResult } from '../test-utils/page-result';
import { VersionManagementPage } from './VersionManagementPage';

vi.mock('../api', () => ({
  api: {
    listProjectVersions: vi.fn(),
    createProjectVersion: vi.fn(),
    updateProjectVersion: vi.fn(),
    deleteProjectVersion: vi.fn(),
    updateProjectCurrentVersion: vi.fn(),
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

describe('VersionManagementPage', () => {
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
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('shows the current project versions and links each version to its work items', async () => {
    await act(async () => {
      root?.render(<MemoryRouter><VersionManagementPage /></MemoryRouter>);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('版本管理');
    expect(container.textContent).not.toContain('Release Management');
    expect(container.textContent).toContain('2.6.0');
    expect(container.textContent).toContain('2.7.0');
    expect(container.textContent).toContain('当前');
    expect(Array.from(container.querySelectorAll('a')).some(link => link.getAttribute('href')?.includes('versionId=version-1'))).toBe(true);
  });
});
