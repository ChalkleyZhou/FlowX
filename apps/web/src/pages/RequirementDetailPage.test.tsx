// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { Requirement } from '../types';
import { RequirementDetailPage } from './RequirementDetailPage';

vi.mock('../api', () => ({ api: { getRequirement: vi.fn(), getProject: vi.fn(), updateRequirement: vi.fn(), createWorkflowRun: vi.fn() } }));
vi.mock('../components/PrototypeImportPanel', () => ({ PrototypeImportPanel: ({ importId, existingWorkflowId }: { importId: string; existingWorkflowId?: string }) => <div data-import={importId} data-workflow={existingWorkflowId}>原型导入面板</div> }));
vi.mock('../components/RequirementSchedulingPanel', () => ({ RequirementSchedulingPanel: () => null }));
vi.mock('../components/RequirementChangesPanel', () => ({ RequirementChangesPanel: ({ requirementId }: { requirementId: string }) => <section data-changes-requirement={requirementId}>需求变更入口</section> }));

const requirement: Requirement = {
  id: 'requirement-1', title: '需求接续', description: '保留已有研发流程', acceptanceCriteria: '可以继续流程',
  ideationStatus: 'FINALIZED',
  project: { id: 'project-1', name: 'FlowX', workspace: { id: 'workspace-1', name: '研发', repositories: [] } },
  workflowRuns: [],
};

function run(id: string, status: string, name: string) {
  return { id, status, workflowRepositories: [{ id: `scope-${id}`, name, status: 'READY' }] };
}
function Location() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}</output>;
}

describe('RequirementDetailPage 流程接续', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.getRequirement).mockResolvedValue(requirement);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });
  async function renderPage() {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/requirements/requirement-1']}><Routes>
        <Route path="/requirements/:id" element={<RequirementDetailPage />} />
        <Route path="/requirements" element={<Location />} />
        <Route path="/workflow-runs/:id" element={<Location />} />
      </Routes></MemoryRouter>);
    });
  }

  it('单条活跃流作为主操作，并显示真实状态与仓库范围', async () => {
    vi.mocked(api.getRequirement).mockResolvedValue({ ...requirement, workflowRuns: [run('run-web', 'SPEC_PLAN_WAITING_CONFIRMATION', 'flowx-web')] });
    await renderPage();
    const link = Array.from(container.querySelectorAll('a')).find((item) => item.textContent === '继续当前工作流');
    expect(link?.getAttribute('href')).toBe('/workflow-runs/run-web');
    expect(container.textContent).toContain('待确认 Spec & Plan');
    expect(container.textContent).toContain('flowx-web');
    expect(container.textContent).not.toContain('正在执行');
    expect(api.createWorkflowRun).not.toHaveBeenCalled();
  });

  it('详情展示功能模块、风险与影响、产品需求文档和备注，空值显示未填写', async () => {
    vi.mocked(api.getRequirement).mockResolvedValue({
      ...requirement,
      functionalModule: '登录',
      riskImpact: '影响已登录会话',
      productRequirementDocument: 'https://example.com/prd',
      remark: '',
    });
    await renderPage();
    expect(container.textContent).toContain('功能模块');
    expect(container.textContent).toContain('登录');
    expect(container.textContent).toContain('风险&影响');
    expect(container.textContent).toContain('影响已登录会话');
    expect(container.textContent).toContain('产品需求文档');
    expect(container.textContent).toContain('https://example.com/prd');
    expect(container.textContent).toContain('备注');
    expect(container.textContent).toContain('未填写');
  });

  it('需求详情提供属于当前需求的共享变更入口', async () => {
    await renderPage();
    expect(container.querySelector('[data-changes-requirement="requirement-1"]')).toBeTruthy();
  });

  it('多条活跃流逐条选择，不能静默将第一条设为当前流程', async () => {
    vi.mocked(api.getRequirement).mockResolvedValue({ ...requirement, workflowRuns: [run('run-web', 'EXECUTION_RUNNING', 'flowx-web'), run('run-api', 'DESIGN_PENDING', 'flowx-api')] });
    await renderPage();
    expect(container.textContent).toContain('选择要继续的工作流');
    expect(container.textContent).not.toContain('继续当前工作流');
    for (const id of ['run-web', 'run-api']) {
      const link = container.querySelector(`a[href="/workflow-runs/${id}"]`);
      expect(link?.textContent).toContain('继续此工作流');
    }
    expect(container.textContent).toContain('flowx-web');
    expect(container.textContent).toContain('flowx-api');
  });

  it('DONE 和 FAILED 仅作为历史查看，仍允许发起新的范围', async () => {
    vi.mocked(api.getRequirement).mockResolvedValue({ ...requirement, workflowRuns: [run('run-done', 'DONE', 'flowx-web'), run('run-failed', 'FAILED', 'flowx-api')] });
    await renderPage();
    expect(container.textContent).toContain('历史工作流');
    expect(container.textContent).toContain('已完成');
    expect(container.textContent).toContain('失败');
    expect(container.textContent).not.toContain('继续此工作流');
    expect(container.textContent).not.toContain('正在执行');
    expect(container.querySelector('a[href="/workflow-runs/run-done"]')?.textContent).toBe('查看历史');
    expect(container.querySelector('a[href="/workflow-runs/run-failed"]')?.textContent).toBe('查看历史');
    expect(container.textContent).toContain('启动研发工作流');
  });

  it('无流程时进入既有仓库与执行器选择入口，保留项目上下文', async () => {
    await renderPage();
    const launch = Array.from(container.querySelectorAll('a,button')).find((item) => item.textContent === '启动研发工作流');
    expect(launch).toBeTruthy();
    await act(async () => { (launch as HTMLElement).click(); });
    expect(container.textContent).toBe('/requirements?projectId=project-1&launchRequirementId=requirement-1');
    expect(api.createWorkflowRun).not.toHaveBeenCalled();
  });

  it('被需求变更替代的旧轮展示明确原因并保留历史入口', async () => {
    vi.mocked(api.getRequirement).mockResolvedValue({ ...requirement, workflowRuns: [{ ...run('run-old', 'FAILED', 'web'), supersededByChangeId: 'change-1' }] });
    await renderPage();
    expect(container.textContent).toContain('已由需求变更替代');
    expect(container.querySelector('a[href="/workflow-runs/run-old"]')?.textContent).toBe('查看历史');
  });

  it('加载失败显示原因和重试入口，重试后恢复详情', async () => {
    vi.mocked(api.getRequirement).mockRejectedValueOnce(new Error('网络暂时不可用')).mockResolvedValueOnce(requirement);
    await renderPage();
    expect(container.textContent).toContain('网络暂时不可用');
    expect(container.textContent).not.toContain('需求未找到');
    const retry = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '重试');
    expect(retry).toBeTruthy();
    await act(async () => { retry?.click(); });
    expect(container.textContent).toContain('需求接续');
    expect(container.textContent).not.toContain('网络暂时不可用');
    expect(api.getRequirement).toHaveBeenCalledTimes(2);
  });

  it('切换需求后迟到的旧请求不能覆盖新的流程入口', async () => {
    let resolvePrevious!: (value: Requirement) => void;
    const previousRequest = new Promise<Requirement>((resolve) => { resolvePrevious = resolve; });
    vi.mocked(api.getRequirement)
      .mockReturnValueOnce(previousRequest)
      .mockResolvedValueOnce({ ...requirement, id: 'requirement-2', title: '第二条需求', workflowRuns: [run('run-second', 'DESIGN_PENDING', 'flowx-api')] });
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/requirements/requirement-1']}>
        <Link to="/requirements/requirement-2">切换需求</Link>
        <Routes><Route path="/requirements/:id" element={<RequirementDetailPage />} /></Routes>
      </MemoryRouter>);
    });
    await act(async () => { (container.querySelector('a') as HTMLElement).click(); });
    expect(container.textContent).toContain('第二条需求');
    await act(async () => { resolvePrevious(requirement); });
    expect(container.textContent).toContain('第二条需求');
    expect(container.querySelector('a[href="/workflow-runs/run-second"]')).toBeTruthy();
  });

  it('原型导入中显示处理面板并隐藏普通启动入口', async () => {
    vi.mocked(api.getRequirement).mockResolvedValue({ ...requirement, prototypeImport: { id: 'import-1', status: 'WAITING_CONFIRMATION' } });
    await renderPage();
    expect(container.querySelector('[data-import="import-1"]')).toBeTruthy();
    expect(container.textContent).not.toContain('启动研发工作流');
    expect(container.textContent).toContain('原型导入完成后自动接入研发流程');
  });

  it('已确认原型传递已有活跃工作流，避免重复启动', async () => {
    vi.mocked(api.getRequirement).mockResolvedValue({ ...requirement, prototypeImport: { id: 'import-1', status: 'CONFIRMED' }, workflowRuns: [run('run-existing', 'SPEC_PLAN_RUNNING', 'web')] });
    await renderPage();
    expect(container.querySelector('[data-import="import-1"]')?.getAttribute('data-workflow')).toBe('run-existing');
  });

  it('详情可以编辑需求名称、描述和补充档案', async () => {
    vi.mocked(api.getProject).mockResolvedValue({
      ...requirement.project,
      versions: [{ id: 'ver-1', name: '2.6.0' }],
    });
    vi.mocked(api.updateRequirement).mockImplementation(async (_id, payload) => ({
      ...requirement,
      ...payload,
      title: payload.title ?? requirement.title,
      description: payload.description ?? requirement.description,
      acceptanceCriteria: payload.acceptanceCriteria ?? requirement.acceptanceCriteria,
    }));
    await renderPage();
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
    await act(async () => {
      setValue('#edit-requirement-title', '改后的名称');
      setValue('#edit-requirement-description', '新的描述');
      setValue('#edit-requirement-module', '登录');
      setValue('#edit-requirement-risk', '影响已登录会话');
    });
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(api.updateRequirement).toHaveBeenCalledWith('requirement-1', expect.objectContaining({
      title: '改后的名称',
      description: '新的描述',
      functionalModule: '登录',
      riskImpact: '影响已登录会话',
    }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('改后的名称');
    expect(container.textContent).toContain('新的描述');
    expect(container.textContent).toContain('登录');
    expect(container.textContent).toContain('影响已登录会话');
  });

});
