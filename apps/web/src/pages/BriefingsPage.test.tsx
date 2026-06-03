// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ToastProvider } from '../components/ui/toast';
import { BriefingsPage } from './BriefingsPage';

vi.mock('../api', () => ({
  api: {
    getProjects: vi.fn(),
    getProjectBriefings: vi.fn(),
    generateProjectBriefing: vi.fn(),
  },
}));

describe('BriefingsPage', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.getProjects).mockResolvedValue([
      {
        id: 'project-1',
        name: 'FlowX',
        workspace: { id: 'workspace-1', name: '研发平台', repositories: [] },
      },
    ]);
    vi.mocked(api.getProjectBriefings).mockResolvedValue([]);
    vi.mocked(api.generateProjectBriefing).mockResolvedValue({
      id: 'briefing-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      date: '2026-06-03T00:00:00.000Z',
      scopeKey: 'scope',
      scope: {},
      status: 'GENERATED',
      markdownContent: '# Briefing',
      htmlContent: '<h1>Briefing</h1>',
      eventCount: 1,
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPage() {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <ToastProvider>
            <BriefingsPage />
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('loads projects and generates a project briefing', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('项目简报');
    expect(document.body.textContent).toContain('FlowX');

    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('生成简报'),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(api.generateProjectBriefing).toHaveBeenCalledWith('project-1', {
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });
});

