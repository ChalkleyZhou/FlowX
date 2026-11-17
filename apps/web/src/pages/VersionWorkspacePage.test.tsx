// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ConfirmProvider } from '../components/ConfirmDialog';
import { pageResult } from '../test-utils/page-result';
import { VersionWorkspacePage } from './VersionWorkspacePage';

vi.mock('../api', () => ({
  api: {
    listProjectVersions: vi.fn(),
    getProjectVersion: vi.fn(),
    listVersionWorkItems: vi.fn(),
    getRequirements: vi.fn(),
    getIssues: vi.fn(),
    getBugs: vi.fn(),
    getWorkItem: vi.fn(),
    updateWorkItem: vi.fn(),
    deleteWorkItem: vi.fn(),
    deleteRequirement: vi.fn(),
  },
}));

vi.mock('../project-scope-context', () => ({
  useProjectScopeOptional: () => ({
    projectId: 'project-1',
    project: { id: 'project-1', name: 'FlowX 控制台', currentVersionId: 'version-1' },
  }),
}));

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function renderWorkspace(entry: string) {
  return (
    <ConfirmProvider>
      <MemoryRouter initialEntries={[entry]}>
        <VersionWorkspacePage />
      </MemoryRouter>
    </ConfirmProvider>
  );
}

describe('VersionWorkspacePage', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.listProjectVersions).mockResolvedValue(pageResult([
      { id: 'version-1', name: '2.6.0' },
      { id: 'version-2', name: '2.7.0' },
    ]));
    vi.mocked(api.getProjectVersion).mockResolvedValue({ id: 'version-1', name: '2.6.0' });
    vi.mocked(api.listVersionWorkItems).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(api.getRequirements).mockResolvedValue(pageResult([]));
    vi.mocked(api.getIssues).mockResolvedValue(pageResult([]));
    vi.mocked(api.getBugs).mockResolvedValue(pageResult([]));
    vi.mocked(api.getWorkItem).mockResolvedValue({
      id: 'work-item-1', displayCode: 'REQ-001', projectId: 'project-1', versionId: 'version-1', workspaceId: 'workspace-1',
      kind: 'REQUIREMENT', title: '需求一', description: '需求描述', remark: '', status: 'ACTIVE', priority: 'HIGH',
      acceptanceCriteria: '', functionalModule: '', riskImpact: '', productRequirementDocument: '', planningStatus: 'UNSCHEDULED',
      ideationStatus: 'NOT_STARTED', revision: 1, updatedAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z',
      version: { id: 'version-1', name: '2.6.0' },
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('opens the current version work-item board and exposes a version switcher', async () => {
    await act(async () => {
      root?.render(renderWorkspace('/versions?projectId=project-1'));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('版本工作台');
    expect(container.textContent).toContain('2.6.0');
    expect(container.textContent).toContain('统一查看需求、问题和缺陷');
    expect(container.textContent).not.toContain('全部');
    expect(container.textContent).toContain('需求');
    expect(container.textContent).toContain('问题');
    expect(container.textContent).toContain('缺陷');
    expect(container.textContent).not.toContain('执行项');
    const versionTrigger = container.querySelector('button[aria-label="切换版本"]');
    expect(versionTrigger).not.toBeNull();
    expect(versionTrigger?.textContent).toContain('2.6.0');
    expect(api.getRequirements).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', versionId: 'version-1', page: 1, pageSize: 20 }));
  });

  it('切换需求 Tab 后按当前项目和版本读取需求分页列表', async () => {
    await act(async () => {
      root?.render(renderWorkspace('/versions?projectId=project-1&versionId=version-1'));
    });
    await act(async () => { await Promise.resolve(); });

    const requirementTab = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '需求');
    await act(async () => {
      requirementTab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    expect(api.getRequirements).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', versionId: 'version-1', page: 1, pageSize: 20 }));
  });

  it('快速新建使用弹框并默认当前工作项类型', async () => {
    await act(async () => {
      root?.render(renderWorkspace('/versions?projectId=project-1&versionId=version-1'));
      await Promise.resolve();
    });

    const quickCreate = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '快速新建');
    await act(async () => { quickCreate?.click(); });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('快速新建需求');
    expect(dialog?.querySelector('#version-work-item-title')).not.toBeNull();
    expect(container.querySelector('#version-work-item-title')).toBeNull();
  });

  it('需求 Tab 展示需求专属字段并通过弹框编辑', async () => {
    vi.mocked(api.getRequirements).mockResolvedValue(pageResult([{
      id: 'requirement-1', title: '需求一', description: '需求描述', priority: 'HIGH',
      createdByName: '产品', createdAt: '2026-11-01T00:00:00.000Z', latestChangeAt: '2026-11-02T00:00:00.000Z',
      latestChangeContent: '最新变更', remark: '需求备注', prototypeImport: null,
    } as never]));
    await act(async () => {
      root?.render(renderWorkspace('/versions?projectId=project-1&versionId=version-1&kind=REQUIREMENT'));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('需求描述');
    expect(container.textContent).toContain('规划版本');
    expect(container.textContent).toContain('未分配');
    expect(container.textContent).not.toContain('需求变更时间');
    expect(container.textContent).not.toContain('最新变更内容');
    expect(container.textContent).not.toContain('需求备注');
    expect(container.querySelectorAll('tbody select')).toHaveLength(0);
    expect(container.querySelector('a[href="/work-items/requirement-1"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '编辑')).toBe(true);
    const title = container.querySelector('tbody button[title="需求一"]') as HTMLButtonElement;
    await act(async () => { title.click(); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('编辑需求');
  });

  it('问题 Tab 展示来源工作流和分支字段并通过弹框编辑', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(pageResult([{
      id: 'issue-1', title: '问题一', description: '问题描述', status: 'OPEN', priority: 'MEDIUM',
      sourceWorkflowRun: { id: 'run-1', status: 'DONE' }, branchName: 'feature/problem',
    } as never]));
    await act(async () => {
      root?.render(renderWorkspace('/versions?projectId=project-1&versionId=version-1&kind=ISSUE'));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('来源工作流');
    expect(container.textContent).toContain('feature/problem');
    expect(container.textContent).toContain('待处理');
    expect(container.querySelectorAll('tbody select')).toHaveLength(0);
    expect(container.querySelector('a[href="/work-items/issue-1"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '编辑')).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '移除')).toBe(true);
  });

  it('缺陷 Tab 展示严重级别和来源工作流字段并通过弹框编辑', async () => {
    vi.mocked(api.getBugs).mockResolvedValue(pageResult([{
      id: 'bug-1', title: '缺陷一', description: '缺陷描述', status: 'FIXING', priority: 'URGENT', severity: 'CRITICAL',
      workflowRun: { id: 'run-2', status: 'DONE' }, branchName: 'fix/bug',
    } as never]));
    await act(async () => {
      root?.render(renderWorkspace('/versions?projectId=project-1&versionId=version-1&kind=BUG'));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('严重级别');
    expect(container.textContent).toContain('来源工作流');
    expect(container.textContent).toContain('修复中');
    expect(container.textContent).toContain('fix/bug');
    expect(container.querySelectorAll('tbody select')).toHaveLength(0);
    expect(container.querySelector('a[href="/work-items/bug-1"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '编辑')).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '移除')).toBe(true);
  });

  it('确认后只解除当前版本，取消或未确认时不改数据', async () => {
    const requirement = {
      id: 'requirement-1', title: '需求一', description: '需求描述', priority: 'HIGH',
    };
    let removed = false;
    vi.mocked(api.getRequirements).mockImplementation(async () => pageResult(removed ? [] : [requirement as never]));
    vi.mocked(api.updateWorkItem).mockImplementation(async () => {
      removed = true;
      return { id: 'requirement-1' } as never;
    });
    await act(async () => {
      root?.render(renderWorkspace('/versions?projectId=project-1&versionId=version-1&kind=REQUIREMENT'));
      await Promise.resolve();
    });

    const remove = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '移除');
    expect(remove).toBeTruthy();
    await act(async () => { remove?.click(); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('移出版本');
    expect(dialog?.textContent).toContain('需求一');
    expect(dialog?.textContent).toContain('不会删除');
    const cancel = Array.from(dialog?.querySelectorAll('button') ?? []).find(button => button.textContent === '取消');
    await act(async () => { cancel?.click(); });
    expect(api.updateWorkItem).not.toHaveBeenCalled();
    expect(api.deleteWorkItem).not.toHaveBeenCalled();
    expect(container.textContent).toContain('需求一');

    await act(async () => { remove?.click(); });
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent === '移除');
    await act(async () => { confirm?.click(); await Promise.resolve(); });
    expect(api.updateWorkItem).toHaveBeenCalledWith('requirement-1', { versionId: null });
    expect(api.deleteWorkItem).not.toHaveBeenCalled();
    expect(api.deleteRequirement).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('需求一');
  });
});
