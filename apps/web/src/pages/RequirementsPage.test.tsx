// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { Requirement } from '../types';
import { RequirementsPage } from './RequirementsPage';

const { successToast, errorToast, confirmDialog } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
  confirmDialog: vi.fn(async () => true),
}));

vi.mock('../api', () => ({
  api: {
    getWorkspaces: vi.fn(),
    getProjects: vi.fn(),
    getRequirements: vi.fn(),
    getWorkflowProviders: vi.fn(),
    createRequirement: vi.fn(),
    updateRequirement: vi.fn(),
    deleteRequirement: vi.fn(),
    createPrototypeImport: vi.fn(),
    createWorkflowRun: vi.fn(),
  },
}));

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({ success: successToast, error: errorToast }),
}));

vi.mock('../components/ConfirmDialog', () => ({
  useConfirm: () => confirmDialog,
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
    priority: 'HIGH',
    versionId: 'ver-1',
    version: { id: 'ver-1', name: '2.6.0' },
    createdByName: '产品甲',
    createdAt: '2026-10-26T08:00:00.000Z',
    functionalModule: '登录模块',
    riskImpact: '影响已登录会话',
    productRequirementDocument: 'https://example.com/prd',
    remark: '内部备忘不进列表',
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
    window.localStorage.clear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    successToast.mockReset();
    errorToast.mockReset();
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }

    vi.mocked(api.getWorkspaces).mockResolvedValue([requirement.project.workspace]);
    vi.mocked(api.getProjects).mockResolvedValue([requirement.project]);
    vi.mocked(api.getRequirements).mockResolvedValue([requirement]);
    vi.mocked(api.getWorkflowProviders).mockResolvedValue({
      defaultProvider: 'codex',
      onlineAvailable: true,
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
    const actions = container.querySelector('tbody tr')?.lastElementChild?.textContent ?? '';
    expect(actions).toContain('详情');
    expect(actions).toContain('编辑');
    expect(actions).toContain('删除');
    expect(actions).not.toContain('排期');
    expect(actions).not.toContain('启动工作流');
    expect(actions).not.toContain('查看流程');
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

  it('需求列表展示项目、版本、名称、描述、优先级、创建人和创建时间', async () => {
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

    const headers = Array.from(container.querySelectorAll('th')).map((cell) => cell.textContent);
    expect(headers).toEqual(['所属项目', '发布版本', '需求名称', '优先级', '规划状态', '功能模块', '备注', '创建人', '创建时间', '需求变更时间', '操作']);
    expect(container.querySelector('th:last-child')?.className).toContain('sticky');
    expect(container.querySelector('th:last-child')?.className).toContain('right-0');
    expect(container.querySelector('tbody td:last-child')?.className).toContain('sticky');
    const cells = Array.from(container.querySelectorAll('tbody td')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim());
    expect(cells.slice(0, 10)).toEqual([
      'FlowX',
      '2.6.0',
      '端云设计闭环',
      '高',
      '未排期',
      requirement.functionalModule,
      requirement.remark,
      '产品甲',
      new Date(requirement.createdAt!).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }),
      '—',
    ]);
    expect(container.textContent).not.toContain(requirement.description);
    expect(container.querySelector('table')?.className).toContain('w-max');
    expect(container.textContent).not.toContain(requirement.acceptanceCriteria);
    expect(container.textContent).not.toContain(requirement.riskImpact);
    expect(container.textContent).not.toContain(requirement.productRequirementDocument);
    expect(container.textContent).not.toContain('人员排期：');
    expect(container.textContent).not.toContain('并行占用：');
  });

  it('有需求变更时列表展示最近变更时间', async () => {
    const latestChangeAt = '2026-10-26T09:30:00.000Z';
    vi.mocked(api.getRequirements).mockResolvedValue([{ ...requirement, latestChangeAt }]);
    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/requirements']}><RequirementsPage /></MemoryRouter>);
    });
    const changeCell = container.querySelectorAll('tbody td')[9];
    expect(changeCell?.textContent).toBe(new Date(latestChangeAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }));
    expect(container.textContent).not.toContain('最新变更正文');
  });

  it('按版本、规划状态和优先级从 URL 恢复组合筛选', async () => {
    const project = {
      ...requirement.project,
      versions: [{ id: 'ver-1', name: '2.6.0' }, { id: 'ver-2', name: '2.7.0' }],
    };
    const matchingRequirement: Requirement = {
      ...requirement,
      id: 'requirement-matching',
      title: '匹配的 2.7.0 需求',
      project,
      versionId: 'ver-2',
      version: { id: 'ver-2', name: '2.7.0' },
      planningStatus: 'IN_PROGRESS',
      priority: 'HIGH',
    };
    const otherRequirement: Requirement = {
      ...requirement,
      id: 'requirement-other',
      title: '不匹配的需求',
      project,
      planningStatus: 'DONE',
      priority: 'LOW',
    };
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getRequirements).mockResolvedValue([matchingRequirement, otherRequirement]);

    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/requirements?workspaceId=workspace-1&projectId=project-1&versionId=ver-2&planningStatus=IN_PROGRESS&priority=HIGH']}>
        <RequirementsPage />
      </MemoryRouter>);
    });

    expect(container.textContent).toContain('匹配的 2.7.0 需求');
    expect(container.textContent).not.toContain('不匹配的需求');
    expect(container.querySelector('[aria-label="按工作区筛选"]')).toBeNull();
    expect(container.querySelector('[aria-label="按发布版本"]')?.textContent).toContain('2.7.0');
    expect(container.querySelector('[aria-label="按规划状态"]')?.textContent).toContain('进行中');
    expect(container.querySelector('[aria-label="按优先级"]')?.textContent).toContain('高');
    expect(container.textContent).not.toContain('默认执行器：Codex');
  });

  it('切换项目时清除不再适用的版本筛选', async () => {
    const secondProject: Requirement['project'] = {
      ...requirement.project,
      id: 'project-2',
      name: '另一个项目',
      currentVersionId: 'ver-3',
      currentVersion: { id: 'ver-3', name: '3.0.0' },
      versions: [{ id: 'ver-3', name: '3.0.0' }],
    };
    vi.mocked(api.getProjects).mockResolvedValue([requirement.project, secondProject]);

    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1&versionId=ver-1']}>
        <RequirementsPage /><LocationProbe />
      </MemoryRouter>);
    });
    const projectSelect = container.querySelector('[aria-label="按项目筛选"]') as HTMLElement;
    await act(async () => { projectSelect.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { (Array.from(document.querySelectorAll('[role="option"]')).find((item) => item.textContent === '另一个项目') as HTMLElement).click(); });

    expect(container.querySelector('output')?.textContent).toBe('/requirements?projectId=project-2');
  });

  it('清除筛选后恢复全量需求并在空结果时给出调整提示', async () => {
    vi.mocked(api.getRequirements).mockResolvedValue([{ ...requirement, planningStatus: 'DONE', priority: 'LOW' }]);
    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/requirements?planningStatus=IN_PROGRESS']}>
        <RequirementsPage /><LocationProbe />
      </MemoryRouter>);
    });
    expect(container.textContent).toContain('当前筛选条件下没有需求，请调整筛选或清除条件');
    await act(async () => { (Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '清除筛选') as HTMLElement).click(); });
    expect(container.querySelector('output')?.textContent).toBe('/requirements');
    expect(container.textContent).toContain('端云设计闭环');
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
      root?.render(<MemoryRouter initialEntries={['/requirements?launchRequirementId=requirement-1']}><Routes>
        <Route path="/requirements" element={<RequirementsPage />} />
        <Route path="/workflow-runs/:id" element={<LocationProbe />} />
      </Routes></MemoryRouter>);
    });
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

  it('创建默认普通填写；原型默认当前版本，失败保留文件后重试接续详情', async () => {
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
    expect(dialog.querySelector('[aria-label="发布版本"]')?.textContent).toBe('2.6.0');
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
    expect(api.createPrototypeImport).toHaveBeenLastCalledWith({ projectId: 'project-1', versionId: 'ver-1', goal: '', aiProvider: 'codex' }, file);
    expect(container.textContent).toBe('/requirements/req-import?importing=1');
  });

  it('原型上传可以改选版本，切换项目后默认新项目当前版本', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.getProjects).mockResolvedValue([
      { ...requirement.project, versions: [{ id: 'ver-1', name: '2.6.0' }, { id: 'ver-2', name: '2.7.0' }] },
      { ...requirement.project, id: 'project-2', name: '另一个项目', currentVersionId: 'ver-3', currentVersion: { id: 'ver-3', name: '3.0.0' }, versions: [{ id: 'ver-3', name: '3.0.0' }] },
    ]);
    vi.mocked(api.createPrototypeImport).mockRejectedValue(new Error('网络中断'));
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1']}><RequirementsPage /></MemoryRouter>); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '创建需求')?.click(); });
    await act(async () => { Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '已有原型')?.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    const version = dialog.querySelector('[aria-label="发布版本"]')!;
    expect(version).toBeTruthy();
    await act(async () => { version.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { (Array.from(document.querySelectorAll('[role="option"]')).find((item) => item.textContent === '2.7.0') as HTMLElement).click(); });
    expect(version.textContent).toBe('2.7.0');
    const file = new File(['zip'], 'prototype.zip', { type: 'application/zip' });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    const submit = () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await act(async () => { submit(); });
    expect(api.createPrototypeImport).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'project-1', versionId: 'ver-2' }), file);
    await act(async () => { dialog.querySelector('[aria-label="所属项目"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { (Array.from(document.querySelectorAll('[role="option"]')).find((item) => item.textContent === '另一个项目') as HTMLElement).click(); });
    expect(dialog.querySelector('[aria-label="发布版本"]')?.textContent).toBe('3.0.0');
    await act(async () => { submit(); });
    expect(api.createPrototypeImport).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'project-2', versionId: 'ver-3' }), file);
  });

  it('原型上传未选择版本时引导设置，不发起上传', async () => {
    vi.mocked(api.getProjects).mockResolvedValue([{ ...requirement.project, currentVersionId: null, currentVersion: null, versions: [] }]);
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1']}><RequirementsPage /></MemoryRouter>); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '创建需求')?.click(); });
    await act(async () => { Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '已有原型')?.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['zip'], 'prototype.zip')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(errorToast).toHaveBeenCalledWith('请选择发布版本');
    expect(api.createPrototypeImport).not.toHaveBeenCalled();
    expect(dialog.querySelector('a[href="/projects/project-1"]')).toBeTruthy();
    expect(input.files?.[0]?.name).toBe('prototype.zip');
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

  it('未完成原型导入在需求列表与启动深链均查看导入进度', async () => {
    vi.mocked(api.getRequirements).mockResolvedValue([{ ...requirement, prototypeImport: { id: 'import-1', status: 'WAITING_CONFIRMATION' } }]);
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?launchRequirementId=requirement-1']}><Routes>
      <Route path="/requirements" element={<RequirementsPage />} />
      <Route path="/requirements/:id" element={<LocationProbe />} />
    </Routes></MemoryRouter>); });
    expect(container.textContent).toBe('/requirements/requirement-1');
    expect(api.createWorkflowRun).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('普通创建只需标题，默认当前版本，其余内容可留空', async () => {
    vi.mocked(api.createRequirement).mockResolvedValue(requirement);
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1']}><RequirementsPage /></MemoryRouter>); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '创建需求')?.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('2.6.0');
    expect(dialog.querySelector('[aria-label="优先级"]')?.textContent).toBe('中');
    expect(dialog.textContent).not.toContain('不挂版本');
    const title = dialog.querySelector('#requirement-title') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(title, '  快捷需求  ');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(api.createRequirement).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', title: '快捷需求', versionId: 'ver-1', priority: 'MEDIUM', description: '', acceptanceCriteria: '', functionalModule: '', riskImpact: '', productRequirementDocument: '', remark: '' }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('普通创建可填写功能模块、风险与影响、产品需求文档和备注', async () => {
    vi.mocked(api.createRequirement).mockResolvedValue(requirement);
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1']}><RequirementsPage /></MemoryRouter>); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '创建需求')?.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    const setValue = (selector: string, value: string) => {
      const field = dialog.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const priority = dialog.querySelector('[aria-label="优先级"]')!;
    await act(async () => { priority.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { (Array.from(document.querySelectorAll('[role="option"]')).find((item) => item.textContent === '紧急') as HTMLElement).click(); });
    await act(async () => {
      setValue('#requirement-title', '补充档案');
      setValue('#requirement-module', '  登录  ');
      setValue('#requirement-risk', '  影响已登录会话  ');
      setValue('#requirement-prd', '  https://example.com/prd  ');
      setValue('#requirement-remark', '  内部备忘  ');
    });
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(api.createRequirement).toHaveBeenCalledWith(expect.objectContaining({
      title: '补充档案',
      priority: 'URGENT',
      functionalModule: '登录',
      riskImpact: '影响已登录会话',
      productRequirementDocument: 'https://example.com/prd',
      remark: '内部备忘',
    }));
  });

  it('普通创建无版本时提示先设置，不能提交', async () => {
    vi.mocked(api.getProjects).mockResolvedValue([{ ...requirement.project, currentVersionId: null, currentVersion: null, versions: [] }]);
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1']}><RequirementsPage /></MemoryRouter>); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '创建需求')?.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    const title = dialog.querySelector('#requirement-title') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(title, '无版本需求');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(api.createRequirement).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith('请选择发布版本');
    expect(dialog.querySelector('a[href="/projects/project-1"]')).toBeTruthy();
  });

  it('普通创建失败后保留输入重试，提交中阻止重复请求', async () => {
    vi.mocked(api.createRequirement).mockRejectedValueOnce(new Error('创建失败，请重试'));
    await act(async () => { root?.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1']}><RequirementsPage /></MemoryRouter>); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '创建需求')?.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    const title = dialog.querySelector('#requirement-title') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(title, '保留草稿');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await act(async () => { submit(); });
    expect(errorToast).toHaveBeenCalledWith('创建失败，请重试');
    expect(title.value).toBe('保留草稿');
    let resolveCreate!: (value: Requirement) => void;
    vi.mocked(api.createRequirement).mockReturnValueOnce(new Promise((resolve) => { resolveCreate = resolve; }));
    await act(async () => { submit(); submit(); });
    expect(api.createRequirement).toHaveBeenCalledTimes(2);
    expect(dialog.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    await act(async () => { Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Close')?.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => { resolveCreate(requirement); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('列表可以编辑需求名称和补充档案，空白名称不提交', async () => {
    vi.mocked(api.updateRequirement).mockImplementation(async (_id, payload) => ({
      ...requirement,
      ...payload,
      description: payload.description ?? requirement.description,
      acceptanceCriteria: payload.acceptanceCriteria ?? requirement.acceptanceCriteria,
    }));
    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/requirements']}><RequirementsPage /></MemoryRouter>);
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '编辑')?.click();
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('编辑需求');
    const setValue = (selector: string, value: string) => {
      const field = dialog.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => { setValue('#edit-requirement-title', '   '); });
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(dialog.textContent).toContain('请填写需求名称');
    expect(api.updateRequirement).not.toHaveBeenCalled();
    await act(async () => {
      setValue('#edit-requirement-title', '  改后的名称  ');
      setValue('#edit-requirement-description', '  新的描述  ');
      setValue('#edit-requirement-module', '  订单  ');
      setValue('#edit-requirement-remark', '  新备注  ');
    });
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(api.updateRequirement).toHaveBeenCalledWith('requirement-1', expect.objectContaining({
      title: '改后的名称',
      description: '新的描述',
      functionalModule: '订单',
      remark: '新备注',
      priority: 'HIGH',
      versionId: 'ver-1',
    }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('改后的名称');
    expect(container.textContent).toContain('订单');
    expect(container.textContent).toContain('新备注');
    expect(container.textContent).toContain('产品甲');
    expect(successToast).toHaveBeenCalledWith('需求已更新');
  });

  it('确认后删除需求并刷新列表，取消时不请求', async () => {
    confirmDialog.mockResolvedValueOnce(false);
    await act(async () => {
      root?.render(<MemoryRouter initialEntries={['/requirements']}><RequirementsPage /></MemoryRouter>);
    });
    const deleteButton = () => container.querySelector('button[aria-label="删除需求：端云设计闭环"]') as HTMLButtonElement;
    await act(async () => { deleteButton().click(); });
    expect(api.deleteRequirement).not.toHaveBeenCalled();

    confirmDialog.mockResolvedValueOnce(true);
    vi.mocked(api.deleteRequirement).mockResolvedValue({ success: true });
    vi.mocked(api.getRequirements).mockResolvedValueOnce([]);
    await act(async () => { deleteButton().click(); });
    expect(api.deleteRequirement).toHaveBeenCalledWith('requirement-1');
    expect(successToast).toHaveBeenCalledWith('需求已删除');
    expect(container.textContent).not.toContain('端云设计闭环');
  });

});
