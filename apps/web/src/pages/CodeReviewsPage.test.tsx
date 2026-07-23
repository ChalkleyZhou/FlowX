// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ToastProvider } from '../components/ui/toast';
import { CodeReviewsPage } from './CodeReviewsPage';

vi.mock('../api', () => ({
  api: {
    getProjects: vi.fn(),
    listProjectDailyCodeReviews: vi.fn(),
    generateProjectDailyCodeReview: vi.fn(),
  },
}));

describe('CodeReviewsPage', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
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
    vi.mocked(api.listProjectDailyCodeReviews).mockResolvedValue([
      {
        id: 'review-1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        date: '2026-06-03T00:00:00.000Z',
        scopeKey: 'scope',
        scope: {},
        status: 'COMPLETED',
        unitsJson: [],
        markdownContent: '# Review',
        htmlContent: '<h1>Review</h1>',
        generatedAt: '2026-06-03T00:10:00.000Z',
        sentAt: null,
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:10:00.000Z',
      },
    ]);
    vi.mocked(api.generateProjectDailyCodeReview).mockResolvedValue({
      id: 'review-2',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      date: '2026-06-03T00:00:00.000Z',
      scopeKey: 'scope',
      scope: {},
      status: 'GENERATING',
      unitsJson: [],
      markdownContent: '',
      htmlContent: '',
      generatedAt: null,
      sentAt: null,
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
            <CodeReviewsPage />
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('lists daily code reviews for the selected project', async () => {
    await renderPage();

    expect(api.getProjects).toHaveBeenCalled();
    expect(api.listProjectDailyCodeReviews).toHaveBeenCalledWith('project-1');
    expect(document.body.textContent).toContain('代码审查');
    expect(document.body.textContent).toContain('FlowX');
    expect(document.body.textContent).toContain('2026-06-03');
  });

  it('triggers generate for the selected project', async () => {
    await renderPage();

    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('生成代码审查'),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(api.generateProjectDailyCodeReview).toHaveBeenCalledWith('project-1', {
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      regenerate: true,
    });
  });

  it('shows an empty state when there are no reviews yet', async () => {
    vi.mocked(api.listProjectDailyCodeReviews).mockResolvedValue([]);

    await renderPage();

    expect(document.body.textContent).toContain('暂无代码审查');
  });
});
