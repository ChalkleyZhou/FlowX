import { pageResult } from './quality/page-result-test';
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
    getProject: vi.fn(),
    getProjects: vi.fn(),
    listProjectDailyCodeReviews: vi.fn(),
    listCodeReviewFeeds: vi.fn(),
    generateCodeReviewFeed: vi.fn(),
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
    vi.mocked(api.getProject).mockImplementation(async id => ([
      {
        id: 'project-1',
        name: 'FlowX',
        workspace: { id: 'workspace-1', name: '研发平台', repositories: [] },
      },
    ]).find(project => project.id === id)!);
    vi.mocked(api.listCodeReviewFeeds).mockResolvedValue(pageResult([
      {
        id: 'feed-1',
        projectId: 'project-1',
        name: '默认',
        enabled: true,
        dailyHour: 22,
        timezone: 'Asia/Shanghai',
        autoSend: true,
        repositoryIds: ['repo-1'],
        deliveryTargetIds: [],
      },
    ]));
    vi.mocked(api.listProjectDailyCodeReviews).mockResolvedValue(pageResult([
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
    ]));
    vi.mocked(api.generateCodeReviewFeed).mockResolvedValue({
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
        <MemoryRouter initialEntries={['/code-reviews?projectId=project-1']}>
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

    expect(api.getProject).toHaveBeenCalledWith('project-1');
    expect(api.listProjectDailyCodeReviews).toHaveBeenCalledWith('project-1', { page: 1, pageSize: 20 });
    expect(document.body.textContent).toContain('代码审查');
    expect(document.body.textContent).not.toContain('项目数');
    expect(document.body.textContent).toContain('已发送');
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

    expect(api.generateCodeReviewFeed).toHaveBeenCalledWith('feed-1', {
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      regenerate: true,
    });
  });

  it('shows an empty state when there are no reviews yet', async () => {
    vi.mocked(api.listProjectDailyCodeReviews).mockResolvedValue(pageResult([]));

    await renderPage();

    expect(document.body.textContent).toContain('暂无代码审查');
  });
});
