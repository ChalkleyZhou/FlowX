// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ThemeProvider } from '../components/theme-provider';
import { ToastProvider } from '../components/ui/toast';
import { QualityPage } from './QualityPage';

vi.mock('../api', () => ({
  api: {
    getWorkspaces: vi.fn(),
    getProjects: vi.fn(),
    getWorkflowRuns: vi.fn(),
    getTestRequests: vi.fn(),
    getTestCaseLibraries: vi.fn(),
    getTestCases: vi.fn(),
    createTestRequest: vi.fn(),
    createTestCaseLibrary: vi.fn(),
    createTestCase: vi.fn(),
  },
}));

describe('QualityPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.getWorkspaces).mockResolvedValue([
      { id: 'workspace-1', name: '研发工作区', repositories: [] },
    ]);
    vi.mocked(api.getProjects).mockResolvedValue([]);
    vi.mocked(api.getWorkflowRuns).mockResolvedValue([]);
    vi.mocked(api.getTestRequests).mockResolvedValue([]);
    vi.mocked(api.getTestCaseLibraries).mockResolvedValue([]);
    vi.mocked(api.getTestCases).mockResolvedValue([]);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('loads the quality overview and exposes the three core views', async () => {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ToastProvider>
            <QualityPage />
          </ToastProvider>
        </ThemeProvider>,
      );
      await Promise.resolve();
    });

    expect(api.getTestRequests).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('测试与质量');
    expect(container.textContent).toContain('提测管理');
    expect(container.textContent).toContain('用例库');
    expect(container.textContent).toContain('执行记录');
    expect(container.textContent).toContain('暂无提测记录');
  });
});
