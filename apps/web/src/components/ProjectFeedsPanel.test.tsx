// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ToastProvider } from './ui/toast';
import { ProjectFeedsPanel } from './ProjectFeedsPanel';

vi.mock('../api', () => ({
  api: {
    listBriefingFeeds: vi.fn(),
    listCodeReviewFeeds: vi.fn(),
    getDeliveryTargets: vi.fn(),
    createBriefingFeed: vi.fn(),
    updateBriefingFeed: vi.fn(),
  },
}));

describe('ProjectFeedsPanel', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.getDeliveryTargets).mockResolvedValue([]);
    vi.mocked(api.listBriefingFeeds).mockResolvedValue([]);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPanel() {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <ToastProvider>
            <ProjectFeedsPanel
              projectId="project-1"
              kind="briefing"
              repositories={[
                { id: 'repo-1', name: 'api', url: 'https://example.com/api.git' },
                { id: 'repo-2', name: 'web', url: 'https://example.com/web.git' },
              ]}
            />
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('shows an empty state when the project has no feeds', async () => {
    await renderPanel();
    expect(document.body.textContent).toContain('还没有简报');
  });

  it('shows repositories that are not part of the feed', async () => {
    vi.mocked(api.listBriefingFeeds).mockResolvedValue([
      {
        id: 'feed-1',
        projectId: 'project-1',
        name: '前端',
        enabled: false,
        dailyHour: 22,
        timezone: 'Asia/Shanghai',
        autoSend: false,
        repositoryIds: ['repo-1'],
        deliveryTargetIds: [],
      },
    ]);

    await renderPanel();

    const nameInput = container.querySelector('input[aria-label="名称"]') as HTMLInputElement | null;
    expect(nameInput?.value).toBe('前端');
    expect(document.body.textContent).toContain('尚未加入：web');
  });
});
