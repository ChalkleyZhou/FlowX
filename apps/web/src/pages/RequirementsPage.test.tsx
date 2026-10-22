// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { Requirement } from '../types';
import { RequirementsPage } from './RequirementsPage';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getWorkspaces: vi.fn(),
    getProjects: vi.fn(),
    getRequirements: vi.fn(),
    getWorkflowProviders: vi.fn(),
    createRequirement: vi.fn(),
    createPrototypeImport: vi.fn(),
    createWorkflowRun: vi.fn(),
  },
}));

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({ success: successToast, error: errorToast }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe('RequirementsPage', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  const requirement: Requirement = {
    id: 'requirement-1',
    title: '端云设计闭环',
    description: '设计师在本地 OpenDesign 完成设计并回传 FlowX。',
    acceptanceCriteria: '设计 Artifact 和 Evidence 可追溯。',
    ideationStatus: 'FINALIZED',
    project: {
      id: 'project-1',
      name: 'FlowX',
      currentVersionId: 'ver-1',
      currentVersion: { id: 'ver-1', name: '2.6.0' },
      versions: [{ id: 'ver-1', name: '2.6.0' }],
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [
          { id: 'repository-1', name: 'flowx-web', url: 'https://example.com/flowx-web.git' },
        ],
      },
    },
    versionId: 'ver-1',
    version: { id: 'ver-1', name: '2.6.0' },
    workflowRuns: [],
    requirementRepositories: [
      {
        id: 'scope-1',
        repository: {
          id: 'repository-1',
          name: 'flowx-web',
          url: 'https://example.com/flowx-web.git',
        },
      },
    ],
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    successToast.mockReset();
    errorToast.mockReset();

    vi.mocked(api.getWorkspaces).mockResolvedValue([requirement.project.workspace]);
    vi.mocked(api.getProjects).mockResolvedValue([requirement.project]);
    vi.mocked(api.getRequirements).mockResolvedValue([requirement]);
    vi.mocked(api.getWorkflowProviders).mockResolvedValue({
      defaultProvider: 'codex',
      providers: [
        { id: 'codex', label: 'Codex' },
        { id: 'cursor', label: 'Cursor CLI' },
      ],
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('does not expose OpenDesign launch from the requirements list', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/requirements']}>
          <Routes>
            <Route path="/requirements" element={<RequirementsPage />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === 'OpenDesign 设计',
    );
    expect(button).toBeUndefined();
    expect(container.textContent).toContain('启动工作流');
  });

  it('keeps only web create as the requirements page CTA', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/requirements']}>
          <Routes>
            <Route path="/requirements" element={<RequirementsPage />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('创建需求');
    expect(container.textContent).not.toContain('用 Cursor / Codex 发起');
    expect(container.textContent).toContain('2.6.0');
    expect(container.textContent).toContain('本页可直接创建需求');

    const webCreate = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === '创建需求',
    );
    expect(webCreate).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (element) => element.textContent?.trim() === '网页创建',
      ),
    ).toBe(false);
  });

  it('消费详情启动链接并保留 projectId，取消或刷新后不重复弹出', async () => {
    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1&launchRequirementId=requirement-1']}>
        <RequirementsPage /><LocationProbe />
      </MemoryRouter>);
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('启动工作流');
    expect(container.querySelector('output')?.textContent).toBe('/requirements?projectId=project-1');
    const cancel = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === '取消');
    await act(async () => { cancel?.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1&launchRequirementId=requirement-1']}>
        <RequirementsPage /><LocationProbe />
      </MemoryRouter>);
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(api.createWorkflowRun).not.toHaveBeenCalled();
  });

  it('启动弹框展示活跃流范围，并允许选择不同仓库启动并行流程', async () => {
    const apiRepository = { id: 'repository-2', name: 'flowx-api', url: 'https://example.com/flowx-api.git' };
    vi.mocked(api.getRequirements).mockResolvedValue([{
      ...requirement,
      requirementRepositories: [...requirement.requirementRepositories!, { id: 'scope-2', repository: apiRepository }],
      workflowRuns: [{ id: 'run-active', status: 'EXECUTION_RUNNING', workflowRepositories: [{ id: 'wr-1', name: 'flowx-web', status: 'READY' }] },
        { id: 'run-done', status: 'DONE', workflowRepositories: [{ id: 'wr-2', name: 'flowx-api', status: 'READY' }] }],
    }]);
    vi.mocked(api.createWorkflowRun).mockResolvedValue({ id: 'run-new' } as Awaited<ReturnType<typeof api.createWorkflowRun>>);
    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/requirements']}><Routes>
        <Route path="/requirements" element={<RequirementsPage />} />
        <Route path="/workflow-runs/:id" element={<LocationProbe />} />
      </Routes></MemoryRouter>);
    });
    const launch = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '启动工作流');
    await act(async () => { launch?.click(); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('已有活跃工作流');
    expect(dialog?.textContent).toContain('flowx-web');
    expect(dialog?.querySelector('a[href="/workflow-runs/run-active"]')).toBeTruthy();
    expect(dialog?.querySelector('a[href="/workflow-runs/run-done"]')).toBeNull();
    const choose = Array.from(dialog?.querySelectorAll('button') ?? []).find((item) => item.textContent === '选择 flowx-api');
    await act(async () => { choose?.click(); });
    const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find((item) => item.textContent === '确认启动');
    expect(confirm?.disabled).toBe(false);
    await act(async () => { confirm?.click(); });
    expect(api.createWorkflowRun).toHaveBeenCalledWith('requirement-1', ['repository-2'], 'codex');
    expect(container.textContent).toBe('/workflow-runs/run-new');
  });

  it('创建默认普通填写；原型入口只需项目和 ZIP，失败保留文件后重试接续详情', async () => {
    vi.mocked(api.createPrototypeImport).mockRejectedValueOnce(new Error('网络中断，请重试')).mockResolvedValueOnce({ requirementId: 'req-import' } as Awaited<ReturnType<typeof api.createPrototypeImport>>);
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1']}><Routes>
      <Route path="/requirements" element={<RequirementsPage />} />
      <Route path="/requirements/:id" element={<LocationProbe />} />
    </Routes></MemoryRouter>); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '创建需求')?.click(); });
    expect(document.querySelector('[role="dialog"] input[id="requirement-title"]')).toBeTruthy();
    await act(async () => { Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '已有原型')?.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('input[id="requirement-title"]')).toBeNull();
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['zip'], 'prototype.zip', { type: 'application/zip' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    const upload = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === '上传原型，AI 整理')!;
    await act(async () => { upload.click(); });
    expect(dialog.textContent).toContain('网络中断，请重试');
    expect(input.files?.[0]).toBe(file);
    expect(api.createRequirement).not.toHaveBeenCalled();
    await act(async () => { upload.click(); });
    expect(api.createPrototypeImport).toHaveBeenLastCalledWith({ projectId: 'project-1', goal: '', aiProvider: 'codex' }, file);
    expect(container.textContent).toBe('/requirements/req-import');
  });

  it('上传中阻止重复提交与关闭弹窗', async () => {
    let resolveUpload!: (value: Awaited<ReturnType<typeof api.createPrototypeImport>>) => void;
    vi.mocked(api.createPrototypeImport).mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1']}><RequirementsPage /></MemoryRouter>); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '创建需求')?.click(); });
    await act(async () => { Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '已有原型')?.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['zip'], 'prototype.zip')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    const form = dialog.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(api.createPrototypeImport).toHaveBeenCalledTimes(1);
    expect(dialog.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    const close = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Close');
    await act(async () => { close?.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => { resolveUpload({ requirementId: 'req-import' } as Awaited<ReturnType<typeof api.createPrototypeImport>>); });
  });

  it('未确认原型在需求列表与启动深链均进入确认页', async () => {
    vi.mocked(api.getRequirements).mockResolvedValue([{ ...requirement, prototypeImport: { id: 'import-1', status: 'WAITING_CONFIRMATION' } }]);
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?launchRequirementId=requirement-1']}><Routes>
      <Route path="/requirements" element={<RequirementsPage />} />
      <Route path="/requirements/:id" element={<LocationProbe />} />
    </Routes></MemoryRouter>); });
    expect(container.textContent).toBe('/requirements/requirement-1');
    expect(api.createWorkflowRun).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

});
