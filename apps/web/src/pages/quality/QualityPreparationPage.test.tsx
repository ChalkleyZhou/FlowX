// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { QualityPreparationPage } from './QualityPreparationPage';
import type { Requirement, TestDesign, WorkflowRun } from '../../types';
vi.mock('../../api', () => ({
  api: {
    getRequirement: vi.fn(),
    getTestDesigns: vi.fn(),
    getWorkflowRuns: vi.fn(),
    getTestCaseLibraries: vi.fn(),
    getTestCaseModules: vi.fn(),
    getTestCases: vi.fn(),
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
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.getRequirement).mockResolvedValue(requirement);
  vi.mocked(api.getWorkflowRuns).mockResolvedValue([run]);
  vi.mocked(api.getTestDesigns).mockResolvedValue([]);
  vi.mocked(api.getTestCaseLibraries).mockResolvedValue([
    { id: 'lib-1', workspaceId: 'ws1', projectId: 'p1', name: '项目库', scope: 'PROJECT', status: 'ACTIVE' },
  ]);
  vi.mocked(api.getTestCaseModules).mockResolvedValue([]);
  vi.mocked(api.getTestCases).mockResolvedValue([]);
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
  vi.mocked(api.getTestDesigns).mockResolvedValue([
    {
      id: 'existing',
      status: 'WAITING_REVIEW',
      revision: 3,
      requirements: [{ requirement: { id: 'req-1', title: '认证改进' } }],
      workflowRuns: [{ workflowRun: { id: 'flow-1', status: 'DONE' } }],
    },
  ] as TestDesign[]);
  await render();
  const link = Array.from(container.querySelectorAll('a')).find(
    (item) => item.textContent === '继续已有测试设计',
  );
  expect(link?.getAttribute('href')).toBe('/quality/test-designs/existing');
  expect(api.createTestDesign).not.toHaveBeenCalled();
});
