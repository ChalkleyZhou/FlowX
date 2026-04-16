// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRunDetailPage } from './WorkflowRunDetailPage';
import { api } from '../api';
import type { WorkflowRun } from '../types';

vi.mock('../api', () => ({
  api: {
    getWorkflowRun: vi.fn(),
    confirmTaskSplit: vi.fn(),
    runTaskSplit: vi.fn(),
    runReview: vi.fn(),
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

  function createWorkflowRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
    return {
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
      ...overrides,
    };
  }

  async function renderPage() {
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
  }

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
    vi.mocked(api.getWorkflowRun).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const text = container.textContent ?? '';

    expect(text).toContain('修复登录流程');
    expect(text).toContain('需求与验收信息');
    expect(text).toContain('用户登录偶发失败，需要补齐错误提示与重试能力。');
    expect(text).toContain('登录失败时展示明确原因，并记录审计日志。');
    expect(text.match(/当前状态/g)).toHaveLength(1);
  });

  it('switches to the next stage card after task split is confirmed', async () => {
    vi.mocked(api.getWorkflowRun)
      .mockResolvedValueOnce(
        createWorkflowRun({
          status: 'TASK_SPLIT_WAITING_CONFIRMATION',
          stageExecutions: [
            {
              id: 'stage-1',
              stage: 'TASK_SPLIT',
              status: 'WAITING_CONFIRMATION',
              statusMessage: null,
              attempt: 1,
              output: { tasks: ['补齐登录错误提示'] },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createWorkflowRun({
          status: 'PLAN_PENDING',
          stageExecutions: [
            {
              id: 'stage-1',
              stage: 'TASK_SPLIT',
              status: 'COMPLETED',
              statusMessage: null,
              attempt: 1,
              output: { tasks: ['补齐登录错误提示'] },
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
        }),
      );
    vi.mocked(api.confirmTaskSplit).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '确认',
    );
    expect(confirmButton).toBeTruthy();
    expect(container.textContent).not.toContain('生成技术方案');

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(api.confirmTaskSplit).toHaveBeenCalledWith('workflow-1');
    expect(container.textContent).toContain('生成技术方案');
  });

  it('prevents duplicate clicks while a stage action is being submitted', async () => {
    let resolveRunTaskSplit: (() => void) | null = null;

    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'TASK_SPLIT_PENDING',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'TASK_SPLIT',
            status: 'NOT_STARTED',
            statusMessage: null,
            attempt: 0,
            output: null,
          },
        ],
      }),
    );
    vi.mocked(api.runTaskSplit).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRunTaskSplit = () => resolve(createWorkflowRun());
        }),
    );

    await renderPage();

    const runButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('执行任务拆解'),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.runTaskSplit).toHaveBeenCalledTimes(1);
    expect(runButton?.hasAttribute('disabled')).toBe(true);

    await act(async () => {
      resolveRunTaskSplit?.();
      await Promise.resolve();
    });
  });

  it('keeps stale review findings actionable while allowing manual rerun from human review pending', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'HUMAN_REVIEW_PENDING',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'TASK_SPLIT',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { tasks: ['补齐登录错误提示'] },
          },
          {
            id: 'stage-2',
            stage: 'TECHNICAL_PLAN',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { summary: '补齐登录失败链路' },
          },
          {
            id: 'stage-3',
            stage: 'EXECUTION',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 2,
            output: { patchSummary: '修复两条审查问题' },
          },
          {
            id: 'stage-4',
            stage: 'AI_REVIEW',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { suggestions: ['补充错误码处理'] },
          },
        ],
        reviewFindings: [
          {
            id: 'finding-1',
            sourceType: 'suggestion',
            sourceIndex: 0,
            type: 'SUGGESTION',
            title: '补充错误码处理',
            description: '登录失败时需要展示更明确的错误原因。',
            severity: 'MEDIUM',
            status: 'OPEN',
            impactScope: [],
            convertedIssueId: null,
            convertedBugId: null,
          },
        ],
      }),
    );

    await renderPage();

    const aiReviewStep = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('AI 审查'),
    );

    await act(async () => {
      aiReviewStep?.click();
      await Promise.resolve();
    });

    const text = container.textContent ?? '';
    expect(text).toContain('当前展示的是上一轮 AI 审查结果');
    expect(text).toContain('重新执行 AI 审查');
    expect(text).toContain('立即修复');
  });

  it('disables fix action for findings that are already fixed pending review', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'HUMAN_REVIEW_PENDING',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'EXECUTION',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 2,
            output: { patchSummary: '修复审查问题' },
          },
          {
            id: 'stage-2',
            stage: 'AI_REVIEW',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { suggestions: ['补充错误码处理'] },
          },
        ],
        reviewFindings: [
          {
            id: 'finding-1',
            sourceType: 'suggestion',
            sourceIndex: 0,
            type: 'SUGGESTION',
            title: '补充错误码处理',
            description: '登录失败时需要展示更明确的错误原因。',
            severity: 'MEDIUM',
            status: 'FIXED_PENDING_REVIEW',
            impactScope: [],
            convertedIssueId: null,
            convertedBugId: null,
          },
        ],
      }),
    );

    await renderPage();

    const aiReviewStep = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('AI 审查'),
    );

    await act(async () => {
      aiReviewStep?.click();
      await Promise.resolve();
    });

    const fixButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('立即修复'),
    );

    expect(container.textContent).toContain('已修复待验证');
    expect(fixButton?.hasAttribute('disabled')).toBe(true);
  });

  it('renders a sticky current-stage action bar for execution and keeps execution actions near diff review', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'REVIEW_PENDING',
        codeExecution: {
          patchSummary: '已完成登录错误处理与重试',
          changedFiles: ['apps/web/src/pages/LoginPage.tsx'],
          codeChanges: [],
          diffArtifacts: [
            {
              repository: 'flowx-web',
              branch: 'codex/fix-login',
              localPath: '/tmp/flowx-web',
              diffStat: '1 file changed',
              diffText: 'diff --git a/apps/web/src/pages/LoginPage.tsx b/apps/web/src/pages/LoginPage.tsx\n+const ok = true;',
              untrackedFiles: [],
            },
          ],
          status: 'COMPLETED',
        },
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'EXECUTION',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { patchSummary: '已完成登录错误处理与重试' },
          },
        ],
      }),
    );

    await renderPage();

    const text = container.textContent ?? '';

    expect(text).toContain('当前阶段操作');
    expect(text).toContain('执行开发');
    expect(text).toContain('开发操作');
    expect(text).toContain('直接在这里继续推进开发阶段');
  });

  it('renders a sticky current-stage action bar for review and keeps review decisions near findings', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'HUMAN_REVIEW_PENDING',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'EXECUTION',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 2,
            output: { patchSummary: '修复审查问题' },
          },
          {
            id: 'stage-2',
            stage: 'AI_REVIEW',
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: { suggestions: ['补充错误码处理'] },
          },
        ],
        reviewFindings: [
          {
            id: 'finding-1',
            sourceType: 'suggestion',
            sourceIndex: 0,
            type: 'SUGGESTION',
            title: '补充错误码处理',
            description: '登录失败时需要展示更明确的错误原因。',
            severity: 'MEDIUM',
            status: 'OPEN',
            impactScope: [],
            convertedIssueId: null,
            convertedBugId: null,
          },
        ],
      }),
    );

    await renderPage();

    const aiReviewStep = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('AI 审查'),
    );

    await act(async () => {
      aiReviewStep?.click();
      await Promise.resolve();
    });

    const text = container.textContent ?? '';

    expect(text).toContain('当前阶段操作');
    expect(text).toContain('通过');
    expect(text).toContain('返工');
    expect(text).toContain('审查决策');
    expect(text).toContain('先处理审查结果，再做最终决策');
  });
});
