// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { WorkItem } from '../types';
import { ToastProvider } from '../components/ui/toast';
import { WorkItemDetailPage } from './WorkItemDetailPage';

vi.mock('../api', () => ({
  api: {
    getWorkItem: vi.fn(),
    getRequirementChanges: vi.fn(),
    startWorkItemWorkflow: vi.fn(),
  },
}));

vi.mock('../components/ExecutionPlanPanel', () => ({ ExecutionPlanPanel: () => <div data-testid="execution-plan">执行计划</div> }));
vi.mock('../components/WorkItemMetaPanel', () => ({ WorkItemMetaPanel: () => <div data-testid="meta-panel">工作项信息</div> }));
vi.mock('../components/WorkItemEditDialog', () => ({ WorkItemEditDialog: ({ open }: { open: boolean }) => open ? <div>编辑工作项对话框</div> : null }));
vi.mock('../components/RequirementChangesPanel', () => ({ RequirementChangesPanel: ({ open }: { open?: boolean }) => <div data-testid="changes-panel">{open ? '变更表单已展开' : '完整修改记录'}</div> }));

const workItem: WorkItem = {
  id: 'work-item-1', projectId: 'project-1', versionId: 'version-1', workspaceId: 'workspace-1', kind: 'REQUIREMENT',
  labels: [{ id: 'label-1', name: '详情优化', color: 'BLUE' }],
  title: '优化需求详情页', description: '需求正文优先展示', remark: '补充说明', status: 'ACTIVE', priority: 'HIGH', ownerUserId: 'user-1',
  ownerUser: { id: 'user-1', displayName: '负责人甲' }, acceptanceCriteria: '可以直接修改工作项信息', functionalModule: '需求中心', riskImpact: '避免遗漏修改项',
  productRequirementDocument: 'PRD 内容', planningStatus: 'PLANNED', ideationStatus: 'NONE', revision: 2,
  version: { id: 'version-1', name: '2.7.0' },
  project: { id: 'project-1', name: 'FlowX', workspace: { id: 'workspace-1', name: '研发', repositories: [] } },
  assignments: [{ id: 'assignment-1', userId: 'user-1', role: '研发', plannedStartDate: '2026-11-18', plannedEndDate: '2026-11-20', sortOrder: 0, estimatedDays: 3 }],
  executionPlans: [{ id: 'plan-1', workItemId: 'work-item-1', status: 'DRAFT', strategy: 'SINGLE', items: [] }],
  updatedAt: '2026-11-18T00:00:00.000Z', createdAt: '2026-11-18T00:00:00.000Z',
};

describe('WorkItemDetailPage', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.getWorkItem).mockResolvedValue(workItem);
    vi.mocked(api.getRequirementChanges).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 3, totalPages: 1, revision: 2 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

  it('先展示需求正文，并接入工作项信息、修改项和排期摘要', async () => {
    await act(async () => {
      root.render(<ToastProvider><MemoryRouter initialEntries={['/work-items/work-item-1']}><Routes><Route path="/work-items/:id" element={<WorkItemDetailPage />} /></Routes></MemoryRouter></ToastProvider>);
    });
    expect(container.textContent).toContain('需求正文优先展示');
    expect(container.querySelector('[title="详情优化"]')).not.toBeNull();
    expect(container.textContent).toContain('工作项信息');
    expect(container.textContent).toContain('版本工作台需求修改项');
    expect(container.textContent).toContain('排期摘要');
    expect(container.textContent).toContain('完整修改记录');
    expect(container.textContent!.indexOf('需求内容')).toBeLessThan(container.textContent!.indexOf('工作项信息'));
    expect(api.getRequirementChanges).toHaveBeenCalledWith('work-item-1', undefined, { page: 1, pageSize: 3 });
  });

  it('从摘要提交变更入口可以展开完整修改表单', async () => {
    await act(async () => {
      root.render(<ToastProvider><MemoryRouter initialEntries={['/work-items/work-item-1']}><Routes><Route path="/work-items/:id" element={<WorkItemDetailPage />} /></Routes></MemoryRouter></ToastProvider>);
    });
    await act(async () => { Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '提交变更')?.click(); });
    expect(container.textContent).toContain('变更表单已展开');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
