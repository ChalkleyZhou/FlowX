// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignArtifactPreview } from './DesignArtifactPreview';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    listWorkflowDesignArtifacts: vi.fn(),
    getWorkflowDesignArtifactPage: vi.fn(),
  },
}));

describe('DesignArtifactPreview', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders surface tabs and page HTML in a sandboxed iframe', async () => {
    const html = '<!doctype html><html><body><h1>Design</h1></body></html>';
    vi.mocked(api.listWorkflowDesignArtifacts).mockResolvedValue({
      surfaces: [
        {
          id: 'Web端',
          pages: [
            {
              id: '首页',
              title: '首页',
              relPath: 'run-1/Web%E7%AB%AF/首页.html',
              bytes: 10,
              generatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
    });
    vi.mocked(api.getWorkflowDesignArtifactPage).mockResolvedValue({
      exists: true,
      html,
      surfaceId: 'Web端',
      pageId: '首页',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    await act(async () => {
      root?.render(<DesignArtifactPreview workflowRunId="run-1" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.listWorkflowDesignArtifacts).toHaveBeenCalledWith('run-1');
    expect(api.getWorkflowDesignArtifactPage).toHaveBeenCalledWith('run-1', 'Web端', '首页');
    expect(container.textContent ?? '').toContain('Web端');
    expect(container.textContent ?? '').toContain('当前包含：Web端(1)');
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('srcdoc')).toBe(html);
  });

  it('shows an empty-state message when no artifact exists yet', async () => {
    vi.mocked(api.listWorkflowDesignArtifacts).mockResolvedValue({ surfaces: [] });

    await act(async () => {
      root?.render(<DesignArtifactPreview workflowRunId="run-2" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent ?? '').toContain('暂无高保真设计稿');
  });
});
