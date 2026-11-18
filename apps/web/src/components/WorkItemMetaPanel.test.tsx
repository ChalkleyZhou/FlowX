// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { WorkItem } from '../types';
import { WorkItemMetaPanel } from './WorkItemMetaPanel';

vi.mock('../api', () => ({
  api: {
    updateWorkItem: vi.fn(),
    getOrganizationMembers: vi.fn(),
    listProjectVersions: vi.fn(),
  },
}));

const workItem: WorkItem = {
  id: 'work-item-1', projectId: 'project-1', versionId: 'version-1', workspaceId: 'workspace-1', kind: 'REQUIREMENT',
  title: '需求', description: '描述', remark: '', status: 'ACTIVE', priority: 'MEDIUM', ownerUserId: 'user-1',
  ownerUser: { id: 'user-1', displayName: '负责人甲' }, acceptanceCriteria: '', functionalModule: '', riskImpact: '',
  productRequirementDocument: '', planningStatus: 'UNSCHEDULED', ideationStatus: 'NONE', revision: 1,
  version: { id: 'version-1', name: '2.6.7' }, project: { id: 'project-1', name: 'FlowX', workspace: { id: 'workspace-1', name: '研发', repositories: [] } },
  updatedAt: '2026-11-18T00:00:00.000Z', createdAt: '2026-11-18T00:00:00.000Z',
};

describe('WorkItemMetaPanel', () => {
  let root: Root;
  let container: HTMLDivElement;
  const onSaved = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.getOrganizationMembers).mockResolvedValue({ items: [{ id: 'user-1', displayName: '负责人甲' }, { id: 'user-2', displayName: '负责人乙' }], page: 1, pageSize: 20, total: 2, totalPages: 1 });
    vi.mocked(api.listProjectVersions).mockResolvedValue({ items: [{ id: 'version-1', name: '2.6.7' }, { id: 'version-2', name: '2.7.0' }], page: 1, pageSize: 20, total: 2, totalPages: 1 });
    vi.mocked(api.updateWorkItem).mockResolvedValue({ ...workItem, priority: 'HIGH', ownerUserId: 'user-2', ownerUser: { id: 'user-2', displayName: '负责人乙' } });
    onSaved.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('默认只读，编辑后保存负责人、优先级和版本', async () => {
    await act(async () => { root.render(<WorkItemMetaPanel workItem={workItem} onSaved={onSaved} />); });
    expect(container.textContent).toContain('负责人甲');
    expect(container.textContent).toContain('2.6.7');

    await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="负责人"]')?.click(); await Promise.resolve(); });
    await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent?.trim() === '负责人乙')?.click(); });
    await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '中')?.click(); });
    await act(async () => { Array.from(document.querySelectorAll<HTMLDivElement>('[role="option"]')).find(option => option.textContent?.trim() === '高')?.click(); });
    await act(async () => { Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '保存')?.click(); });

    expect(api.updateWorkItem).toHaveBeenCalledWith('work-item-1', { ownerUserId: 'user-2', priority: 'HIGH', versionId: 'version-1' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ priority: 'HIGH', ownerUserId: 'user-2' }));
  });

  it('保存失败保留编辑态并显示错误', async () => {
    vi.mocked(api.updateWorkItem).mockRejectedValueOnce(new Error('保存冲突'));
    await act(async () => { root.render(<WorkItemMetaPanel workItem={workItem} onSaved={onSaved} />); });
    await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); });
    await act(async () => { Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '保存')?.click(); });
    expect(container.textContent).toContain('保存冲突');
    expect(container.textContent).toContain('取消');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
