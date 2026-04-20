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
    reviseTaskSplit: vi.fn(),
    runTaskSplit: vi.fn(),
    runPlan: vi.fn(),
    confirmPlan: vi.fn(),
    rejectPlan: vi.fn(),
    revisePlan: vi.fn(),
    runExecution: vi.fn(),
    reviseExecution: vi.fn(),
    runReview: vi.fn(),
    reviseReview: vi.fn(),
    decideHumanReview: vi.fn(),
    syncReviewFindings: vi.fn(),
    fixReviewFinding: vi.fn(),
    convertReviewFindingToIssue: vi.fn(),
    convertReviewFindingToBug: vi.fn(),
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

  it('renders the review sidebar inside a desktop sticky shell', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const stickyShell = container.querySelector('[data-testid="workflow-review-sidebar-shell"]');

    expect(stickyShell).toBeTruthy();
    expect(stickyShell?.className).toContain('min-[1281px]:sticky');
    expect(stickyShell?.className).toContain('min-[1281px]:top-6');
  });

  it('shows branch info as a lightweight expandable summary near the header', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        workflowRepositories: [
          {
            id: 'repo-1',
            repositoryId: 'repository-1',
            name: 'flowx-web',
            url: 'https://example.com/flowx-web.git',
            baseBranch: 'main',
            workingBranch: 'codex/fix-login',
            status: 'READY',
          },
          {
            id: 'repo-2',
            repositoryId: 'repository-2',
            name: 'flowx-api',
            url: 'https://example.com/flowx-api.git',
            baseBranch: 'main',
            workingBranch: 'codex/fix-auth',
            status: 'READY',
          },
        ],
      }),
    );

    await renderPage();

    const text = container.textContent ?? '';
    expect(text).toContain('工作分支：flowx-web / codex/fix-login 等 2 个');
    expect(text).toContain('查看分支');
    expect(text).not.toContain('需求仓库范围');

    const branchButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('查看分支'),
    );

    await act(async () => {
      branchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('flowx-api');
    expect(container.textContent).toContain('codex/fix-auth');
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

  it('renders a persistent workflow review sidebar for waiting-confirmation stages', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
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
    );

    await renderPage();

    const text = container.textContent ?? '';
    expect(text).toContain('工作流反馈区');
    expect(text).toContain('发送修改意见');
    expect(text).not.toContain('人工修改');
  });

  it('clears workflow feedback after a successful revise submit', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
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
    );
    vi.mocked(api.reviseTaskSplit).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '把任务拆分成前后端两块');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('发送修改意见'),
    );

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.reviseTaskSplit).toHaveBeenCalledWith('workflow-1', '把任务拆分成前后端两块');
    expect((container.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('');
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

  it('renders the workflow review sidebar for execution while keeping diff review on the left', async () => {
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

    expect(text).toContain('工作流反馈区');
    expect(text).toContain('发送修改意见');
    expect(text).toContain('代码变更审查');
  });

  it('renders the workflow review sidebar for review and keeps findings on the left', async () => {
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

    expect(text).toContain('工作流反馈区');
    expect(text).toContain('通过');
    expect(text).toContain('AI 审查结果');
    expect(text).toContain('立即修复');
    expect(text).not.toContain('返工');
    expect(text).not.toContain('回滚');
  });
});
