// @vitest-environment jsdom
import { pageResult } from './page-result-test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { QualityPreparationPage } from './QualityPreparationPage';
import type { Requirement, TestDesign, WorkflowRun } from '../../types';
vi.mock('../../api', () => ({
  api: {
    getTestCasesPage: vi.fn(),
    getRequirement: vi.fn(),
    getTestDesigns: vi.fn(),
    getWorkflowRuns: vi.fn(),
    getTestCaseLibraries: vi.fn(),
    getTestCaseModules: vi.fn(),
        createTestDesign: vi.fn(),
  },
}));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
let root: Root;
let container: HTMLDivElement;
const requirement = {
  id: 'req-1',
  title: '认证改进',
  versionId: 'v1',
  project: { id: 'p1', name: '项目', workspace: { id: 'ws1' } },
} as Requirement;
const run = { id: 'flow-1', status: 'DONE', requirement } as WorkflowRun;
beforeEach(() => {
  vi.mocked(api.getTestCasesPage).mockResolvedValue(pageResult([]));
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.getRequirement).mockResolvedValue(requirement);
  vi.mocked(api.getWorkflowRuns).mockResolvedValue(pageResult([run]));
  vi.mocked(api.getTestDesigns).mockResolvedValue(pageResult([]));
  vi.mocked(api.getTestCaseLibraries).mockResolvedValue(pageResult([
    { id: 'lib-1', workspaceId: 'ws1', projectId: 'p1', name: '项目库', scope: 'PROJECT', status: 'ACTIVE' },
  ]));
  vi.mocked(api.getTestCaseModules).mockResolvedValue(pageResult([]));
  vi.mocked(api.getTestCasesPage).mockResolvedValue(pageResult([]));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <MemoryRouter
        initialEntries={['/quality/test-designs/new?requirementId=req-1&projectId=p1&projectVersionId=v1']}
      >
        <Routes>
          <Route path="/quality/test-designs/new" element={<QualityPreparationPage />} />
          <Route path="/quality/test-designs/:id" element={<p>设计详情</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
it('从需求预填上下文，显式提交所选库和工作流', async () => {
  vi.mocked(api.createTestDesign).mockResolvedValue({ id: 'design-1' } as TestDesign);
  await render();
  expect(container.textContent).toContain('认证改进');
  await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="用例库 项目库"]')?.click());
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((item) => item.textContent === '创建测试设计并选例')
      ?.click(),
  );
  expect(api.createTestDesign).toHaveBeenCalledWith({
    workspaceId: 'ws1',
    projectId: 'p1',
    projectVersionId: 'v1',
    requirementIds: ['req-1'],
    workflowRunIds: ['flow-1'],
    caseSelection: { libraryIds: ['lib-1'] },
  });
  expect(container.textContent).toContain('设计详情');
});
it('已有当前需求设计时优先继续，不重复创建', async () => {
  vi.mocked(api.getTestDesigns).mockResolvedValue(pageResult([
    {
      id: 'existing',
      status: 'WAITING_REVIEW',
      revision: 3,
      requirements: [{ requirement: { id: 'req-1', title: '认证改进' } }],
      workflowRuns: [{ workflowRun: { id: 'flow-1', status: 'DONE' } }],
    },
  ] as TestDesign[]));
  await render();
  const link = Array.from(container.querySelectorAll('a')).find(
    (item) => item.textContent === '继续已有测试设计',
  );
  expect(link?.getAttribute('href')).toBe('/quality/test-designs/existing');
  expect(api.createTestDesign).not.toHaveBeenCalled();
});

it('未完成研发但最新Spec & Plan已完成时可准备设计，进行中的新尝试不能沿用旧就绪状态', async () => {
  vi.mocked(api.getWorkflowRuns).mockResolvedValue(pageResult([
    { ...run, id: 'ready-flow', status: 'EXECUTION_PENDING', stageExecutions: [{ id: 'spec-ready', stage: 'SPEC_PLAN', status: 'COMPLETED', attempt: 1, output: {} }] },
    { ...run, id: 'retry-flow', status: 'SPEC_PLAN_PENDING', stageExecutions: [{ id: 'spec-retry', stage: 'SPEC_PLAN', status: 'RUNNING', attempt: 2, output: null }] },
  ]));
  await render();
  const ready = container.querySelector<HTMLAnchorElement>('a[href="/workflow-runs/ready-flow"]')!.closest('label')!.querySelector('input')!;
  const retry = container.querySelector<HTMLAnchorElement>('a[href="/workflow-runs/retry-flow"]')!.closest('label')!.querySelector('input')!;
  expect(ready.disabled).toBe(false); expect(ready.checked).toBe(true);
  expect(retry.disabled).toBe(true); expect(retry.checked).toBe(false);
  expect(api.getTestDesigns).toHaveBeenCalledWith(expect.objectContaining({ requirementId: 'req-1', page: 1, pageSize: 1, projectId: 'p1', projectVersionId: 'v1' }));
});
