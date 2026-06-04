// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ToastProvider } from '../components/ui/toast';
import { BriefingDetailPage } from './BriefingDetailPage';

vi.mock('../api', () => ({
  api: {
    getBriefing: vi.fn(),
    sendBriefing: vi.fn(),
  },
}));

describe('BriefingDetailPage', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.getBriefing).mockResolvedValue({
      id: 'briefing-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      date: '2026-06-03T00:00:00.000Z',
      scopeKey: 'scope',
      scope: { repositoryIds: ['repo-1'], briefingSourceIds: ['source-1'] },
      status: 'GENERATED',
      markdownContent: '# Daily Briefing\n\nFlowX summary',
      htmlContent: '<h1>Daily Briefing</h1><p>FlowX</p>',
      eventCount: 3,
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
      deliveryLogs: [
        {
          id: 'log-1',
          briefingId: 'briefing-1',
          deliveryTargetId: 'target-1',
          channel: 'EMAIL',
          status: 'SUCCESS',
          createdAt: '2026-06-03T00:00:00.000Z',
          deliveryTarget: {
            id: 'target-1',
            projectId: 'project-1',
            type: 'EMAIL',
            name: 'Team',
            isActive: true,
          },
        },
      ],
    });
    vi.mocked(api.sendBriefing).mockResolvedValue({ successCount: 1, targetCount: 1 });
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
        <MemoryRouter initialEntries={['/briefings/briefing-1']}>
          <ToastProvider>
            <Routes>
              <Route path="/briefings/:briefingId" element={<BriefingDetailPage />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('renders briefing content and resends the briefing', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('简报详情');
    expect(document.body.textContent).toContain('FlowX');
    expect(document.body.textContent).toContain('Team');

    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('重新发送'),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(api.sendBriefing).toHaveBeenCalledWith('briefing-1');
  });
});

