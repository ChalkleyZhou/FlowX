// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ToastProvider } from '../components/ui/toast';
import { DailyCodeReviewDetailPage } from './DailyCodeReviewDetailPage';

vi.mock('../api', () => ({
  api: {
    getDailyCodeReview: vi.fn(),
    sendDailyCodeReview: vi.fn(),
  },
}));

describe('DailyCodeReviewDetailPage', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.getDailyCodeReview).mockResolvedValue({
      id: 'review-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      date: '2026-07-07T00:00:00.000Z',
      scopeKey: 'scope',
      scope: {},
      status: 'COMPLETED',
      unitsJson: [
        {
          repositoryName: 'flowx-api',
          repositoryId: 'repo-1',
          ref: 'main',
          commits: [{ id: 'abc123', message: 'feat: add review' }],
          status: 'COMPLETED',
          findings: {
            issues: ['Missing edge-case handling'],
            bugs: [],
            missingTests: [],
            suggestions: [],
            impactScope: [],
          },
        },
      ],
      markdownContent: '# Daily Code Review\n\nReview summary',
      htmlContent: '<h1>Daily Code Review</h1>',
      generatedAt: '2026-07-07T10:00:00.000Z',
      sentAt: null,
      createdAt: '2026-07-07T10:00:00.000Z',
      updatedAt: '2026-07-07T10:00:00.000Z',
      deliveryLogs: [],
    });
    vi.mocked(api.sendDailyCodeReview).mockResolvedValue({ successCount: 1, targetCount: 1 });
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
        <MemoryRouter initialEntries={['/daily-code-reviews/review-1']}>
          <ToastProvider>
            <Routes>
              <Route path="/daily-code-reviews/:reviewId" element={<DailyCodeReviewDetailPage />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('renders review content and resends the report', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('每日 Code Review 详情');
    expect(document.body.textContent).toContain('flowx-api / main');
    expect(document.body.textContent).toContain('Review summary');

    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('重新发送'),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(api.sendDailyCodeReview).toHaveBeenCalledWith('review-1');
  });
});
