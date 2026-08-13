// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ProjectVersionsPanel } from './ProjectVersionsPanel';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    listProjectVersions: vi.fn(),
    createProjectVersion: vi.fn(),
    updateProjectVersion: vi.fn(),
    deleteProjectVersion: vi.fn(),
    updateProjectCurrentVersion: vi.fn(),
  },
}));

vi.mock('./ui/toast', () => ({
  useToast: () => ({ success: successToast, error: errorToast }),
}));

describe('ProjectVersionsPanel', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.listProjectVersions).mockResolvedValue([{ id: 'ver-1', name: '2.6.0' }]);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    document.body.innerHTML = '';
  });

  it('shows the current version and disables deleting it', async () => {
    await act(async () => {
      root?.render(<ProjectVersionsPanel projectId="proj-1" currentVersionId="ver-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('2.6.0');
    expect(container.textContent).toContain('当前');
    const deleteButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === '删除',
    );
    expect(deleteButton?.hasAttribute('disabled')).toBe(true);
    expect(deleteButton?.getAttribute('title')).toBe('仍是当前版本');
  });
});
