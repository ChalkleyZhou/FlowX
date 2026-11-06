// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { pageResult } from '../pages/quality/page-result-test';
import { ToastProvider } from './ui/toast';
import { ProjectFeedsPanel } from './ProjectFeedsPanel';

vi.mock('../api', () => ({
  api: {
    listBriefingFeeds: vi.fn(),
    getWorkspaceRepositories: vi.fn(),
    listCodeReviewFeeds: vi.fn(),
    getDeliveryTargets: vi.fn(),
    createBriefingFeed: vi.fn(),
    updateBriefingFeed: vi.fn(),
    deleteBriefingFeed: vi.fn(),
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
    vi.mocked(api.getWorkspaceRepositories).mockResolvedValue(pageResult([{ id: 'repo-1', name: 'api', url: 'https://example.com/api.git' }, { id: 'repo-2', name: 'web', url: 'https://example.com/web.git' }]));
    vi.mocked(api.getDeliveryTargets).mockResolvedValue(pageResult([]));
    vi.mocked(api.listBriefingFeeds).mockResolvedValue(pageResult([]));
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
              workspaceId="workspace-1"
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
    vi.mocked(api.listBriefingFeeds).mockResolvedValue(pageResult([
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
    ]));

    await renderPanel();

    const nameInput = container.querySelector('input[aria-label="名称"]') as HTMLInputElement | null;
    expect(nameInput?.value).toBe('前端');
    expect(document.body.textContent).toContain('本页尚未加入：web');
  });
  it('按服务端页加载独立配置，选仓库时保留其他页已选ID', async () => {
    vi.mocked(api.listBriefingFeeds).mockResolvedValue(pageResult([{ id: 'feed-1', projectId: 'project-1', name: '配置', enabled: false, dailyHour: 22, timezone: 'Asia/Shanghai', autoSend: false, repositoryIds: ['outside-page'], deliveryTargetIds: [] }], { total: 21, totalPages: 2 }));
    await renderPanel();
    const repoButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'api');
    await act(async () => repoButton?.click());
    expect(api.updateBriefingFeed).toHaveBeenCalledWith('feed-1', { repositoryIds: ['outside-page', 'repo-1'] });
    const next = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '下一页' && !button.disabled);
    await act(async () => next?.click());
    expect(api.listBriefingFeeds).toHaveBeenLastCalledWith('project-1', { page: 2, pageSize: 20, q: undefined });
  });

  it('删除末页最后一项后回到最后有效页，只重载该页', async () => {
    let deleted = false;
    vi.mocked(api.listBriefingFeeds).mockImplementation(async (_id, query) => {
      const page = query?.page ?? 1;
      const items = deleted && page === 2 ? [] : [{ id: page === 2 ? 'last-feed' : 'first-feed', projectId: 'project-1', name: page === 2 ? '末页配置' : '首页配置', enabled: false, dailyHour: 22, timezone: 'Asia/Shanghai', autoSend: false, repositoryIds: [], deliveryTargetIds: [] }];
      return pageResult(items, { page, total: deleted ? 20 : 21, totalPages: deleted ? 1 : 2 });
    });
    vi.mocked(api.deleteBriefingFeed).mockImplementation(async () => { deleted = true; return {} as never; });
    await renderPanel();
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('nav[aria-label="配置列表分页"] button')).find(button => button.textContent === '下一页')?.click());
    expect(container.querySelector<HTMLInputElement>('input[aria-label="名称"]')?.value).toBe('末页配置');
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '删除')?.click());
    expect(api.deleteBriefingFeed).toHaveBeenCalledWith('last-feed');
    expect(api.listBriefingFeeds).toHaveBeenLastCalledWith('project-1', { page: 1, pageSize: 20, q: undefined });
    expect(container.querySelector<HTMLInputElement>('input[aria-label="名称"]')?.value).toBe('首页配置');
    expect(container.querySelector('nav[aria-label="配置列表分页"]')?.textContent).toContain('第 1 / 1 页');
    expect(api.listBriefingFeeds).toHaveBeenCalledTimes(4);
  });

});
