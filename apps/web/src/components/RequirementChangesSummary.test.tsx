// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { RequirementChange } from '../types';
import { RequirementChangesSummary } from './RequirementChangesSummary';

vi.mock('../api', () => ({ api: { getRequirementChanges: vi.fn() } }));

const record = (revision: number): RequirementChange => ({
  id: `change-${revision}`, workItemId: 'req-1', revision, content: `修改内容 ${revision}`, mode: 'SUPPLEMENT',
  createdByName: '产品甲', createdAt: '2026-11-18T00:00:00.000Z', sourceWorkflowRunId: null, restartWorkflowRunId: null,
  prototype: null, restartStatus: 'NOT_REQUESTED', errorMessage: null,
});

describe('RequirementChangesSummary', () => {
  let root: Root;
  let container: HTMLDivElement;
  const onViewAll = vi.fn();
  const onCreateChange = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(api.getRequirementChanges).mockResolvedValue({ items: [record(3), record(2), record(1)], total: 4, page: 1, pageSize: 3, totalPages: 2, revision: 3, changes: [record(3), record(2), record(1)] });
    onViewAll.mockReset(); onCreateChange.mockReset();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });

  afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

  it('读取最近三条并提供查看全部和提交变更入口', async () => {
    await act(async () => { root.render(<RequirementChangesSummary requirementId="req-1" onViewAll={onViewAll} onCreateChange={onCreateChange} />); });
    expect(api.getRequirementChanges).toHaveBeenCalledWith('req-1', undefined, { page: 1, pageSize: 3 });
    expect(container.textContent).toContain('修改内容 3');
    expect(container.textContent).toContain('修改内容 1');
    expect(container.textContent).toContain('查看全部修改');
    await act(async () => { Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '查看全部修改')?.click(); });
    await act(async () => { Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '提交变更')?.click(); });
    expect(onViewAll).toHaveBeenCalledOnce();
    expect(onCreateChange).toHaveBeenCalledOnce();
  });

  it('失败后显示错误和重试入口', async () => {
    vi.mocked(api.getRequirementChanges).mockRejectedValueOnce(new Error('修改项服务不可用'));
    await act(async () => { root.render(<RequirementChangesSummary requirementId="req-1" onViewAll={onViewAll} onCreateChange={onCreateChange} />); });
    expect(container.textContent).toContain('修改项服务不可用');
    vi.mocked(api.getRequirementChanges).mockResolvedValueOnce({ items: [record(1)], total: 1, page: 1, pageSize: 3, totalPages: 1, revision: 1, changes: [record(1)] });
    await act(async () => { Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '重试')?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain('修改内容 1');
  });
});
