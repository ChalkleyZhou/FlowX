// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import type { Project, TestCaseDefinition, TestCaseLibrary, TestRequest, Workspace } from '../../types';
import { QualityCasesPage } from './QualityCasesPage';
import { QualityRequestsPage } from './QualityRequestsPage';
import { QualityRunsPage } from './QualityRunsPage';

const { errorToast, successToast } = vi.hoisted(() => ({
  errorToast: vi.fn(),
  successToast: vi.fn(),
}));

vi.mock('../../api', () => ({
  api: {
    getWorkspaces: vi.fn(),
    getProjects: vi.fn(),
    getWorkflowRuns: vi.fn(),
    getTestRequests: vi.fn(),
    getTestCaseLibraries: vi.fn(),
    getTestCases: vi.fn(),
    getTestCasesPage: vi.fn(),
    createTestRequest: vi.fn(),
    createTestCaseLibrary: vi.fn(),
    createTestCase: vi.fn(),
    importTestCases: vi.fn(),
    deleteTestCase: vi.fn(),
  },
}));

vi.mock('../../components/ui/toast', () => ({
  useToast: () => ({ error: errorToast, success: successToast }),
}));

const workspace: Workspace = {
  id: 'workspace-1',
  name: '研发工作区',
  repositories: [],
};

const project: Project = {
  id: 'project-1',
  name: 'FlowX',
  workspace,
  currentVersionId: 'version-1',
  currentVersion: { id: 'version-1', name: '2.6.0' },
  versions: [{ id: 'version-1', name: '2.6.0' }],
};

const library: TestCaseLibrary = {
  id: 'library-1',
  workspaceId: workspace.id,
  scope: 'WORKSPACE',
  name: '核心回归库',
  status: 'ACTIVE',
};

const testCase: TestCaseDefinition = {
  id: 'case-1',
  libraryId: library.id,
  status: 'ACTIVE',
  version: 3,
  title: '登录后恢复原访问页面',
  priority: 'P0',
  steps: ['打开受保护页面', '完成登录'],
  expected: '自动返回登录前页面',
  tags: ['登录', '回归'],
  library,
  module: { id: 'module-1', name: '认证' },
  coverageLinks: [{
    id: 'coverage-1',
    targetType: 'REQUIREMENT',
    targetKey: 'requirement-1',
    source: 'MANUAL',
  }],
};

const testRequest: TestRequest = {
  id: 'request-1',
  workspaceId: workspace.id,
  projectId: project.id,
  projectVersionId: 'version-1',
  title: '2.6.0 登录能力提测',
  description: '覆盖登录与会话恢复。',
  status: 'IN_TEST',
  scopeGenerationStatus: 'COMPLETED',
  scopeSummary: '覆盖认证主链路和历史缺陷回归。',
  scopeRevision: 1,
  traceId: 'trace-1',
  createdAt: '2026-09-07T08:00:00.000Z',
  project: { id: project.id, name: project.name },
  projectVersion: { id: 'version-1', name: '2.6.0' },
  requirementLinks: [{ requirement: { id: 'requirement-1', title: '登录体验优化' } }],
  workflowLinks: [],
  artifactLinks: [],
  testPlan: {
    id: 'plan-1',
    status: 'ACTIVE',
    snapshots: [],
    runs: [{
      id: 'run-1',
      name: '缺陷修复回归 #2',
      runType: 'REGRESSION',
      status: 'ACTIVE',
      startedAt: '2026-09-07T09:00:00.000Z',
      sourceBug: { id: 'bug-1', title: '登录跳转丢失目标地址' },
      cases: [],
    }],
  },
};

describe('Quality pages', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    errorToast.mockReset();
    successToast.mockReset();
    vi.mocked(api.getWorkspaces).mockResolvedValue([workspace]);
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getWorkflowRuns).mockResolvedValue([]);
    vi.mocked(api.getTestRequests).mockResolvedValue([testRequest]);
    vi.mocked(api.getTestCaseLibraries).mockResolvedValue([library]);
    vi.mocked(api.getTestCases).mockResolvedValue([testCase]);
    vi.mocked(api.getTestCasesPage).mockResolvedValue({
      items: [testCase],
      total: 1,
      page: 1,
      pageSize: 20,
      summary: { p0Count: 1, linkedCount: 1 },
    });
    vi.mocked(api.deleteTestCase).mockResolvedValue({ success: true });
    vi.mocked(api.importTestCases).mockResolvedValue({ imported: 1 });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function renderPage(path: string, element: React.ReactNode) {
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={[path]}>
          <ConfirmProvider>
            <Routes>
              <Route path="/quality/:section" element={element} />
            </Routes>
          </ConfirmProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('shows test requests as an independent page without content tabs', async () => {
    await renderPage('/quality/test-requests', <QualityRequestsPage />);

    expect(api.getTestRequests).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('2.6.0 登录能力提测');
    expect(container.textContent).toContain('覆盖认证主链路和历史缺陷回归');
    expect(container.querySelector('section[aria-label="提测记录"] > .bg-card')).toBeTruthy();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('loads the selected workspace case library and test cases', async () => {
    await renderPage('/quality/test-cases?workspaceId=workspace-1', <QualityCasesPage />);

    expect(api.getTestCaseLibraries).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      projectId: undefined,
    });
    expect(api.getTestCasesPage).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      projectId: undefined,
      libraryId: undefined,
      priority: undefined,
      q: undefined,
      page: 1,
      pageSize: 20,
    });
    expect(container.textContent).toContain('登录后恢复原访问页面');
    expect(container.textContent).not.toContain('自动返回登录前页面');
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).toContain('归属');
    expect(container.querySelector('section[aria-label="测试用例"] > .bg-card')).toBeTruthy();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.includes('批量导入'))).toBe(true);

    const viewButton = container.querySelector(
      'button[aria-label="查看用例：登录后恢复原访问页面"]',
    ) as HTMLButtonElement | null;
    await act(async () => viewButton?.click());
    expect(document.body.textContent).toContain('自动返回登录前页面');
  });

  it('confirms before deleting a test case and refreshes the server page', async () => {
    await renderPage('/quality/test-cases?workspaceId=workspace-1', <QualityCasesPage />);

    const deleteButton = container.querySelector(
      'button[aria-label="删除用例：登录后恢复原访问页面"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      deleteButton?.click();
      await Promise.resolve();
    });

    const confirmButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除用例',
    );
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.deleteTestCase).toHaveBeenCalledWith('case-1');
    expect(api.getTestCasesPage).toHaveBeenCalledTimes(2);
    expect(successToast).toHaveBeenCalledWith('测试用例已删除');
  });

  it('opens the batch import dialog with a CSV template action', async () => {
    await renderPage('/quality/test-cases?workspaceId=workspace-1', <QualityCasesPage />);

    const importButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('批量导入'),
    );
    await act(async () => importButton?.click());

    expect(document.body.textContent).toContain('选择目标用例库并上传填写完成的 CSV 模板');
    expect(document.body.textContent).toContain('下载模板');
    expect(document.body.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.csv,text/csv');
  });

  it('maps test plan runs into the execution history page', async () => {
    await renderPage('/quality/test-runs', <QualityRunsPage />);

    expect(container.textContent).toContain('缺陷修复回归 #2');
    expect(container.textContent).toContain('登录跳转丢失目标地址');
    expect(container.textContent).toContain('Bug 回归');
    expect(container.querySelector('section[aria-label="执行历史"] > .bg-card')).toBeTruthy();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});
