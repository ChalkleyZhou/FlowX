// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRunDetailPage } from './WorkflowRunDetailPage';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getWorkflowRun: vi.fn(),
  },
}));

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('WorkflowRunDetailPage', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders workflow context separately from the header summary', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue({
      id: 'workflow-1',
      status: 'PLAN_PENDING',
      aiProvider: 'codex',
      requirement: {
        id: 'req-1',
        title: '修复登录流程',
        description: '用户登录偶发失败，需要补齐错误提示与重试能力。',
        acceptanceCriteria: '登录失败时展示明确原因，并记录审计日志。',
        ideationStatus: 'FINALIZED',
        project: {
          id: 'project-1',
          name: 'Account Center',
          workspace: {
            id: 'workspace-1',
            name: 'Growth',
            repositories: [],
          },
        },
        requirementRepositories: [],
      },
      workflowRepositories: [],
      tasks: [],
      plan: {
        summary: '补齐登录失败链路',
        implementationPlan: ['更新接口错误处理'],
        filesToModify: ['apps/web/src/pages/LoginPage.tsx'],
        newFiles: [],
        riskPoints: ['兼容旧错误码'],
        status: 'PENDING',
      },
      codeExecution: {
        patchSummary: '',
        changedFiles: [],
        codeChanges: [],
        diffArtifacts: [],
        status: 'PENDING',
      },
      reviewReport: {
        id: 'review-1',
        issues: [],
        bugs: [],
        missingTests: [],
        suggestions: [],
        impactScope: [],
        status: 'PENDING',
      },
      reviewFindings: [],
      stageExecutions: [
        {
          id: 'stage-1',
          stage: 'TASK_SPLIT',
          status: 'COMPLETED',
          statusMessage: null,
          attempt: 1,
          output: { tasks: [] },
        },
        {
          id: 'stage-2',
          stage: 'TECHNICAL_PLAN',
          status: 'PENDING',
          statusMessage: null,
          attempt: 1,
          output: { summary: '补齐登录失败链路' },
        },
      ],
    });

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/workflow-runs/workflow-1']}>
          <Routes>
            <Route path="/workflow-runs/:workflowRunId" element={<WorkflowRunDetailPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const text = container.textContent ?? '';

    expect(text).toContain('修复登录流程');
    expect(text).toContain('需求与验收信息');
    expect(text).toContain('用户登录偶发失败，需要补齐错误提示与重试能力。');
    expect(text).toContain('登录失败时展示明确原因，并记录审计日志。');
    expect(text.match(/当前状态/g)).toHaveLength(1);
  });
});
