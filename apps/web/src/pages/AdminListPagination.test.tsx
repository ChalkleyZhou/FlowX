// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { BriefingSourcesPage } from './BriefingSourcesPage';
import { DeliveryTargetsPage } from './DeliveryTargetsPage';
import { pageResult } from './quality/page-result-test';

vi.mock('../api', () => ({ api: {
  getWorkspaces: vi.fn(), getWorkspace: vi.fn(), getWorkspaceRepositories: vi.fn(),
  getBriefingSources: vi.fn(), getDeliveryTargets: vi.fn(), getProjects: vi.fn(),
  resolveBriefingRepositoryBinding: vi.fn(), getOrganizationMembers: vi.fn(),
}, toApiUrl: (value: string) => value }));
vi.mock('../components/ui/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('../components/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.mocked(api.getWorkspaces).mockResolvedValue(pageResult([{ id: 'ws-1', name: '工作区', repositories: [] }]));
  vi.mocked(api.getWorkspaceRepositories).mockResolvedValue(pageResult([]));
  vi.mocked(api.getProjects).mockResolvedValue(pageResult([{ id: 'project-1', name: '项目', workspace: { id: 'ws-1', name: '工作区', repositories: [] } }]));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
async function click(text: string) {
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === text && !button.disabled)?.click());
}
function input(label: string, value: string) {
  const element = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('管理页服务端分页', () => {
  it('数据源翻页和搜索均透传工作区，不显示请求失败的假空态', async () => {
    vi.mocked(api.getBriefingSources).mockResolvedValue(pageResult([], { total: 21, totalPages: 2 }));
    await act(async () => root.render(<BriefingSourcesPage />));
    await click('下一页');
    expect(api.getBriefingSources).toHaveBeenLastCalledWith({ workspaceId: 'ws-1', page: 2, pageSize: 20, q: undefined });
    vi.mocked(api.getBriefingSources).mockRejectedValue(new Error('数据源暂不可用'));
    await act(async () => input('搜索数据源', 'GitLab'));
    expect(api.getBriefingSources).toHaveBeenLastCalledWith({ workspaceId: 'ws-1', page: 1, pageSize: 20, q: 'GitLab' });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('数据源暂不可用');
    expect(container.textContent).not.toContain('暂无数据源');
  });
  it('投递列表分页，组织成员选择按需分页加载', async () => {
    vi.mocked(api.getDeliveryTargets).mockResolvedValue(pageResult([], { total: 21, totalPages: 2 }));
    vi.mocked(api.getOrganizationMembers).mockResolvedValue(pageResult([{ id: 'user-1', displayName: '李四', status: 'ACTIVE', roles: [] }]));
    await act(async () => root.render(<DeliveryTargetsPage />));
    await click('下一页');
    expect(api.getDeliveryTargets).toHaveBeenLastCalledWith({ workspaceId: 'ws-1', page: 2, pageSize: 20, q: undefined });
    const memberPicker = container.querySelector<HTMLButtonElement>('button[aria-label="组织成员"]');
    await act(async () => memberPicker?.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(api.getOrganizationMembers).toHaveBeenCalledWith({ page: 1, pageSize: 20, q: undefined, status: 'ACTIVE' });
    await act(async () => container.querySelector<HTMLButtonElement>('[role="option"]')?.click());
    expect(container.querySelector<HTMLInputElement>('input[placeholder="名称"]')?.value).toBe('李四');
  });
});
