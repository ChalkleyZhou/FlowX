// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignArtifactPreview } from './DesignArtifactPreview';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getWorkflowDesignArtifact: vi.fn(),
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

  it('renders the design HTML inside a sandboxed iframe via srcDoc', async () => {
    const html = '<!doctype html><html><body><h1>Design</h1></body></html>';
    vi.mocked(api.getWorkflowDesignArtifact).mockResolvedValue({
      exists: true,
      html,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    await act(async () => {
      root?.render(<DesignArtifactPreview workflowRunId="run-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.getWorkflowDesignArtifact).toHaveBeenCalledWith('run-1');
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('srcdoc')).toBe(html);
  });

  it('shows an empty-state message when no artifact exists yet', async () => {
    vi.mocked(api.getWorkflowDesignArtifact).mockResolvedValue({ exists: false, html: null });

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
