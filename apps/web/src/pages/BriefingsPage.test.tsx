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
    listProjectDailyCodeReviews: vi.fn(),
    generateProjectBriefing: vi.fn(),
    generateProjectDailyCodeReview: vi.fn(),
  },
}));

describe('BriefingsPage', () => {
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
    vi.mocked(api.getProjectBriefings).mockResolvedValue([]);
    vi.mocked(api.listProjectDailyCodeReviews).mockResolvedValue([]);
    vi.mocked(api.generateProjectBriefing).mockResolvedValue({
      id: 'briefing-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      date: '2026-06-03T00:00:00.000Z',
      period: 'DAILY',
      periodStart: '2026-06-02T14:00:00.000Z',
      periodEnd: '2026-06-03T14:00:00.000Z',
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
      period: 'DAILY',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      regenerate: true,
    });
  });

  it('generates a weekly project briefing when weekly period is selected', async () => {
    await renderPage();

    const periodTrigger = Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('日报'),
    );
    expect(periodTrigger).toBeTruthy();

    await act(async () => {
      periodTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const weeklyOption = Array.from(document.querySelectorAll('[role="option"]')).find((item) =>
      item.textContent?.includes('周报'),
    );
    expect(weeklyOption).toBeTruthy();

    await act(async () => {
      weeklyOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.textContent).toContain('周内日期');
    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('生成周报'),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(api.generateProjectBriefing).toHaveBeenCalledWith('project-1', {
      period: 'WEEKLY',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      regenerate: true,
    });
  });

  it('restores the last selected project when re-entering the page', async () => {
    vi.mocked(api.getProjects).mockResolvedValue([
      {
        id: 'project-1',
        name: 'FlowX',
        workspace: { id: 'workspace-1', name: '研发平台', repositories: [] },
      },
      {
        id: 'project-2',
        name: 'Portal',
        workspace: { id: 'workspace-2', name: '业务平台', repositories: [] },
      },
    ]);
    window.localStorage.setItem(
      'flowx-briefings-page-preferences',
      JSON.stringify({ projectId: 'project-2', activeView: 'code-reviews', period: 'WEEKLY' }),
    );

    await renderPage();

    expect(api.getProjectBriefings).toHaveBeenCalledWith('project-2');
    expect(api.listProjectDailyCodeReviews).toHaveBeenCalledWith('project-2');
    expect(document.body.textContent).toContain('Portal');
    expect(document.body.textContent).toContain('Code Review 历史');
  });

  it('shows weekly briefing type and range in history', async () => {
    vi.mocked(api.getProjectBriefings).mockResolvedValue([
      {
        id: 'weekly-1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        date: '2026-06-14T16:00:00.000Z',
        period: 'WEEKLY',
        periodStart: '2026-06-14T16:00:00.000Z',
        periodEnd: '2026-06-21T16:00:00.000Z',
        scopeKey: 'weekly-scope',
        scope: { rangeLabel: '2026-06-15 至 2026-06-21' },
        status: 'GENERATED',
        markdownContent: '# Weekly',
        htmlContent: '<h1>Weekly</h1>',
        eventCount: 3,
        createdAt: '2026-06-21T16:00:00.000Z',
        updatedAt: '2026-06-21T16:00:00.000Z',
      },
    ]);

    await renderPage();

    expect(document.body.textContent).toContain('周报');
    expect(document.body.textContent).toContain('2026-06-15 至 2026-06-21');
  });
});
