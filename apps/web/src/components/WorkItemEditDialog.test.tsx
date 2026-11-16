// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { WorkItem } from '../types';
import { ToastProvider } from './ui/toast';
import { WorkItemEditDialog } from './WorkItemEditDialog';

vi.mock('../api', () => ({
  api: {
    updateWorkItem: vi.fn(),
    listProjectVersions: vi.fn(),
  },
}));

const workItem: WorkItem = {
  id: 'work-item-1',
  displayCode: 'REQ-001',
  projectId: 'project-1',
  versionId: 'version-1',
  workspaceId: 'workspace-1',
  kind: 'REQUIREMENT',
  title: '原始标题',
  description: '原始描述',
  remark: '原始备注',
  status: 'ACTIVE',
  priority: 'HIGH',
  acceptanceCriteria: '',
  functionalModule: '',
  riskImpact: '',
  productRequirementDocument: '',
  planningStatus: 'UNSCHEDULED',
  ideationStatus: 'DRAFT',
  revision: 1,
  updatedAt: '2026-11-16T00:00:00.000Z',
  createdAt: '2026-11-15T00:00:00.000Z',
  project: { id: 'project-1', name: 'FlowX', workspace: { id: 'workspace-1', name: '研发空间', repositories: [] } },
  version: { id: 'version-1', name: '2.6.7' },
};

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('WorkItemEditDialog', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(api.listProjectVersions).mockResolvedValue({ items: [{ id: 'version-1', name: '2.6.7' }], page: 1, pageSize: 20, total: 1, totalPages: 1 });
    vi.mocked(api.updateWorkItem).mockResolvedValue({ ...workItem, title: '更新后的标题' });
    onOpenChange.mockReset();
    onSaved.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    root = null;
    vi.clearAllMocks();
  });

  function renderDialog(item = workItem) {
    act(() => {
      root?.render(
        <MemoryRouter>
          <ToastProvider>
            <WorkItemEditDialog workItem={item} open onOpenChange={onOpenChange} onSaved={onSaved} />
          </ToastProvider>
        </MemoryRouter>,
      );
    });
  }

  it('shows common fields with code and readonly status', async () => {
    renderDialog();
    await act(async () => { await Promise.resolve(); });

    expect(document.body.textContent).toContain('编辑需求');
    expect(document.body.textContent).toContain('REQ-001');
    expect(document.body.textContent).toContain('ACTIVE');
    expect((document.querySelector('#work-item-edit-title') as HTMLInputElement).value).toBe('原始标题');
    expect((document.querySelector('#work-item-edit-description') as HTMLTextAreaElement).value).toBe('原始描述');
    expect((document.querySelector('#work-item-edit-remark') as HTMLTextAreaElement).value).toBe('原始备注');
    expect(document.querySelector('[data-work-item-status]')).not.toBeNull();
  });

  it('rejects an empty title and saves the trimmed common fields', async () => {
    renderDialog();
    await act(async () => { await Promise.resolve(); });
    const title = document.querySelector('#work-item-edit-title') as HTMLInputElement;
    const description = document.querySelector('#work-item-edit-description') as HTMLTextAreaElement;
    const remark = document.querySelector('#work-item-edit-remark') as HTMLTextAreaElement;
    setValue(title, '  新标题  ');
    setValue(description, ' 新描述 ');
    setValue(remark, ' 新备注 ');
    setValue(title, '   ');
    await act(async () => { (document.querySelector('form') as HTMLFormElement).requestSubmit(); });
    expect(api.updateWorkItem).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('请填写标题');

    setValue(title, ' 新标题 ');
    await act(async () => { (document.querySelector('form') as HTMLFormElement).requestSubmit(); });
    expect(api.updateWorkItem).toHaveBeenCalledWith('work-item-1', expect.objectContaining({ title: '新标题', description: '新描述', remark: '新备注', versionId: 'version-1', updatedAt: workItem.updatedAt }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ title: '更新后的标题' }));
  });

  it('keeps the dialog open with the error when saving fails', async () => {
    vi.mocked(api.updateWorkItem).mockRejectedValueOnce(new Error('版本已被其他人修改'));
    renderDialog();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { (document.querySelector('form') as HTMLFormElement).requestSubmit(); });
    expect(document.body.textContent).toContain('版本已被其他人修改');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
