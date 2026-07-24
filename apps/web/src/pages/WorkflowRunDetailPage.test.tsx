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
    runBrainstorm: vi.fn(),
    runDesign: vi.fn(),
    reviseWorkflowDesign: vi.fn(),
    confirmWorkflowDesign: vi.fn(),
    rejectWorkflowDesign: vi.fn(),
    runDemo: vi.fn(),
    reviseDemo: vi.fn(),
    confirmDemo: vi.fn(),
    runTaskSplit: vi.fn(),
    skipBrainstorm: vi.fn(),
    skipDesign: vi.fn(),
    skipDemo: vi.fn(),
    detectLocalDev: vi.fn(),
    getLocalDevStatus: vi.fn(),
    startLocalDevPreview: vi.fn(),
    stopLocalDevPreview: vi.fn(),
    runPlan: vi.fn(),
    confirmPlan: vi.fn(),
    rejectPlan: vi.fn(),
    revisePlan: vi.fn(),
    fetchPlanArtifact: vi.fn(),
    runExecution: vi.fn(),
    reviseExecution: vi.fn(),
    runReview: vi.fn(),
    reviseReview: vi.fn(),
    decideHumanReview: vi.fn(),
    syncReviewFindings: vi.fn(),
    fixReviewFinding: vi.fn(),
    convertReviewFindingToIssue: vi.fn(),
    convertReviewFindingToBug: vi.fn(),
    claimLocalExecution: vi.fn(),
    issueLocalLaunchTicket: vi.fn(),
    getLocalHandoff: vi.fn(),
    getExecutionSession: vi.fn(),
    listExecutionSessionEvidence: vi.fn(),
    listExecutionSessionEvents: vi.fn(),
    retryOpenDesignHandoff: vi.fn(),
    retryOpenDesignBrainstormHandoff: vi.fn(),
    getOpenDesignHandoff: vi.fn(),
    getOpenDesignBrainstormHandoff: vi.fn(),
  },
  getFlowxApiBaseUrl: () => 'http://127.0.0.1:3000',
}));

const { probeFlowxLocal, launchFlowxLocal, launchOpenDesignLocal, submitOpenDesignLocal } =
  vi.hoisted(() => ({
    probeFlowxLocal: vi.fn(),
    launchFlowxLocal: vi.fn(),
    launchOpenDesignLocal: vi.fn(),
    submitOpenDesignLocal: vi.fn(),
  }));

vi.mock('../lib/flowx-local-bridge', () => ({
  probeFlowxLocal,
  launchFlowxLocal,
  launchOpenDesignLocal,
  submitOpenDesignLocal,
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

  it('renders optional ideation stages before task split', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'BRAINSTORM_PENDING',
        stageExecutions: [
          {
            id: 'stage-grounding',
            stage: 'REPOSITORY_GROUNDING',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { repositories: [] },
          },
          {
            id: 'stage-brainstorm',
            stage: 'BRAINSTORM',
            status: 'PENDING',
            statusMessage: '可生成产品简报，也可以跳过构思继续',
            attempt: 1,
            output: null,
          },
        ],
      }),
    );

    await renderPage();

    const text = container.textContent ?? '';
    expect(text).toContain('产品构思');
    expect(text).toContain('打开本地构思');
    expect(text).toContain('回传规格');
    expect(text).toContain('AI 生成产品简报');
    expect(text).toContain('跳过构思');
    expect(text).toContain('设计方案');
    expect(text).toContain('Demo 页面');
  });

  it('starts workflow brainstorm from the brainstorm stage card', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'BRAINSTORM_PENDING',
        stageExecutions: [
          {
            id: 'stage-brainstorm',
            stage: 'BRAINSTORM',
            status: 'PENDING',
            statusMessage: '可生成产品简报，也可以跳过构思继续',
            attempt: 1,
            output: null,
          },
        ],
      }),
    );
    vi.mocked(api.runBrainstorm).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const runButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('AI 生成产品简报'),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.runBrainstorm).toHaveBeenCalledWith('workflow-1');
  });

  it('starts workflow design from the design stage card', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'DESIGN_PENDING',
        stageExecutions: [
          {
            id: 'stage-brainstorm',
            stage: 'BRAINSTORM',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { brief: { expandedDescription: 'Expanded', userStories: [], edgeCases: [], successMetrics: [], openQuestions: [], assumptions: [], outOfScope: [] } },
          },
          {
            id: 'stage-design',
            stage: 'DESIGN',
            status: 'PENDING',
            statusMessage: '可生成设计方案，也可以跳过设计继续',
            attempt: 1,
            output: null,
          },
        ],
      }),
    );
    vi.mocked(api.runDesign).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const runButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('AI 生成设计方案'),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.runDesign).toHaveBeenCalledWith('workflow-1');
  });

  it('starts workflow demo generation from the demo stage card', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'DEMO_PENDING',
        stageExecutions: [
          {
            id: 'stage-brainstorm',
            stage: 'BRAINSTORM',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { brief: { expandedDescription: 'Expanded', userStories: [], edgeCases: [], successMetrics: [], openQuestions: [], assumptions: [], outOfScope: [] } },
          },
          {
            id: 'stage-design',
            stage: 'DESIGN',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { design: { overview: 'Overview', pages: [], demoScenario: 'Scenario', designRationale: 'Rationale' } },
          },
          {
            id: 'stage-demo',
            stage: 'DEMO',
            status: 'PENDING',
            statusMessage: '可生成 Demo 页面，也可以跳过 Demo 进入任务拆解',
            attempt: 1,
            output: null,
          },
        ],
      }),
    );
    vi.mocked(api.runDemo).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const runButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('生成 Demo 页面'),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.runDemo).toHaveBeenCalledWith('workflow-1');
  });

  it('confirms demo before entering task split', async () => {
    vi.mocked(api.getWorkflowRun)
      .mockResolvedValueOnce(
        createWorkflowRun({
          status: 'DEMO_WAITING_CONFIRMATION',
          workflowRepositories: [
            {
              id: 'repo-1',
              repositoryId: 'repository-1',
              name: 'flowx-web',
              url: 'https://example.com/flowx-web.git',
              baseBranch: 'main',
              workingBranch: 'codex/demo-preview',
              status: 'READY',
              localPath: '/tmp/flowx-web',
            },
          ],
          stageExecutions: [
            {
              id: 'stage-demo',
              stage: 'DEMO',
              status: 'WAITING_CONFIRMATION',
              statusMessage: '请确认当前 Demo，再进入任务拆解',
              attempt: 1,
              output: {
                demoPages: [{ filePath: 'src/demo.tsx', componentName: 'DemoPanel', routePath: '/demo' }],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createWorkflowRun({
          status: 'TASK_SPLIT_PENDING',
          stageExecutions: [
            {
              id: 'stage-demo',
              stage: 'DEMO',
              status: 'COMPLETED',
              statusMessage: null,
              attempt: 1,
              output: {
                demoPages: [{ filePath: 'src/demo.tsx', componentName: 'DemoPanel', routePath: '/demo' }],
              },
            },
            {
              id: 'stage-task-split',
              stage: 'TASK_SPLIT',
              status: 'PENDING',
              statusMessage: null,
              attempt: 1,
              output: null,
            },
          ],
        }),
      );
    vi.mocked(api.detectLocalDev).mockResolvedValue({ command: 'pnpm dev', packageManager: 'pnpm' } as never);
    vi.mocked(api.getLocalDevStatus).mockResolvedValue({
      status: 'running',
      running: true,
      previewUrl: 'http://127.0.0.1:4173',
      port: 4173,
      command: 'pnpm dev',
      logTail: '',
      lastError: null,
    } as never);
    vi.mocked(api.confirmDemo).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const confirmButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.trim() === '确认 Demo',
    );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.confirmDemo).toHaveBeenCalledWith('workflow-1');
    expect(container.textContent).toContain('执行任务拆解');
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

  it('shows demo feedback in the right sidebar instead of the main content card', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'DEMO_WAITING_CONFIRMATION',
        workflowRepositories: [
          {
            id: 'repo-1',
            repositoryId: 'repository-1',
            name: 'flowx-web',
            url: 'https://example.com/flowx-web.git',
            baseBranch: 'main',
            workingBranch: 'codex/demo-preview',
            status: 'READY',
            localPath: '/tmp/flowx-web',
          },
        ],
        stageExecutions: [
          {
            id: 'stage-grounding',
            stage: 'REPOSITORY_GROUNDING',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { repositories: [] },
          },
          {
            id: 'stage-demo',
            stage: 'DEMO',
            status: 'WAITING_CONFIRMATION',
            statusMessage: '请确认当前 Demo，再进入任务拆解',
            attempt: 1,
            output: {
              demo: {
                summary: '验证通知列表的筛选与详情查看流程',
                flows: [
                  {
                    name: '筛选通知',
                    goal: '验证用户可以按类型和时间过滤列表',
                    entry: '通知列表顶部筛选区',
                    states: ['默认列表', '筛选后结果'],
                  },
                ],
                scope: {
                  included: ['通知列表', '详情弹层'],
                  excluded: ['批量处理'],
                },
                knownGaps: ['数据仍为 mock'],
              },
              demoPages: [{ filePath: 'src/demo.tsx', componentName: 'DemoPanel', routePath: '/demo' }],
            },
          },
        ],
      }),
    );
    vi.mocked(api.detectLocalDev).mockResolvedValue({ command: 'pnpm dev', packageManager: 'pnpm' } as never);
    vi.mocked(api.getLocalDevStatus).mockResolvedValue({
      status: 'running',
      running: true,
      previewUrl: 'http://127.0.0.1:4173',
      port: 4173,
      command: 'pnpm dev',
      logTail: '',
      lastError: null,
    } as never);

    await renderPage();

    const demoStepButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Demo 页面'),
    );

    await act(async () => {
      demoStepButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const shell = container.querySelector('[data-testid="workflow-review-sidebar-shell"]');
    expect(shell?.textContent).toContain('Demo 反馈区');
    expect(shell?.textContent).toContain('发送 Demo 修改意见');
    expect(container.textContent).toContain('验证通知列表的筛选与详情查看流程');
    expect(container.textContent).toContain('通知列表');
    expect(container.textContent).not.toContain('DemoPanel');
  });

  it('opens the demo preview in a dialog from a single entry button', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'DEMO_WAITING_CONFIRMATION',
        workflowRepositories: [
          {
            id: 'repo-1',
            repositoryId: 'repository-1',
            name: 'flowx-web',
            url: 'https://example.com/flowx-web.git',
            baseBranch: 'main',
            workingBranch: 'codex/demo-preview',
            status: 'READY',
            localPath: '/tmp/flowx-web',
          },
        ],
        stageExecutions: [
          {
            id: 'stage-grounding',
            stage: 'REPOSITORY_GROUNDING',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { repositories: [] },
          },
          {
            id: 'stage-demo',
            stage: 'DEMO',
            status: 'WAITING_CONFIRMATION',
            statusMessage: '请确认当前 Demo，再进入任务拆解',
            attempt: 1,
            output: {
              demoPages: [{ filePath: 'src/demo.tsx', componentName: 'DemoPanel', routePath: '/demo' }],
            },
          },
        ],
      }),
    );
    vi.mocked(api.detectLocalDev).mockResolvedValue({ command: 'pnpm dev', packageManager: 'pnpm' } as never);
    vi.mocked(api.getLocalDevStatus).mockResolvedValue({
      status: 'running',
      running: true,
      previewUrl: 'http://127.0.0.1:4173',
      port: 4173,
      command: 'pnpm dev',
      logTail: '',
      lastError: null,
    } as never);

    await renderPage();

    const demoStepButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Demo 页面'),
    );

    await act(async () => {
      demoStepButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const previewButton = container.querySelector('[data-testid="demo-preview-open"]');
    expect(previewButton?.textContent).toContain('打开本地预览');
    expect(container.textContent).not.toContain('本地预览与反馈');

    await act(async () => {
      previewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Demo 本地预览');
    expect(document.body.querySelector('iframe[title="本地 Demo 预览"]')).toBeTruthy();
  });

  it('uses workflow repository row id for local dev when workspace repositoryId is unlinked', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'DEMO_WAITING_CONFIRMATION',
        workflowRepositories: [
          {
            id: 'wf-repo-row-only',
            repositoryId: null,
            name: 'flowx-web',
            url: 'https://example.com/flowx-web.git',
            baseBranch: 'main',
            workingBranch: 'codex/demo-preview',
            status: 'READY',
            localPath: '/tmp/wf-only-clone',
          },
        ],
        stageExecutions: [
          {
            id: 'stage-grounding',
            stage: 'REPOSITORY_GROUNDING',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { repositories: [] },
          },
          {
            id: 'stage-demo',
            stage: 'DEMO',
            status: 'WAITING_CONFIRMATION',
            statusMessage: '请确认当前 Demo，再进入任务拆解',
            attempt: 1,
            output: {
              demoPages: [{ filePath: 'src/demo.tsx', componentName: 'DemoPanel', routePath: '/demo' }],
            },
          },
        ],
      }),
    );
    vi.mocked(api.detectLocalDev).mockResolvedValue({ command: 'pnpm dev', packageManager: 'pnpm' } as never);
    vi.mocked(api.getLocalDevStatus).mockResolvedValue({
      status: 'running',
      running: true,
      previewUrl: 'http://127.0.0.1:4173',
      port: 4173,
      command: 'pnpm dev',
      logTail: '',
      lastError: null,
    } as never);

    await renderPage();

    const demoStepButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Demo 页面'),
    );

    await act(async () => {
      demoStepButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const previewButton = container.querySelector('[data-testid="demo-preview-open"]');
    await act(async () => {
      previewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.detectLocalDev).toHaveBeenCalledWith('wf-repo-row-only', 'workflow-1');
  });

  it('renders plan HTML preview when technical plan stage has an artifact pointer', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'PLAN_WAITING_CONFIRMATION',
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
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: {
              summary: '补齐登录失败链路',
              implementationPlan: ['更新接口错误处理'],
              filesToModify: ['apps/web/src/pages/LoginPage.tsx'],
              newFiles: [],
              riskPoints: ['兼容旧错误码'],
              _artifact: {
                kind: 'plan',
                version: 1,
                htmlPath: 'plan/v1/plan.html',
                metaPath: 'plan/v1/plan.meta.json',
                sha256: 'abc123',
              },
            },
          },
        ],
      }),
    );
    vi.mocked(api.fetchPlanArtifact).mockResolvedValue('<html><body>Plan</body></html>');

    await renderPage();

    await act(async () => {
      await Promise.resolve();
    });

    expect(api.fetchPlanArtifact).toHaveBeenCalledWith('workflow-1');
    expect(container.textContent).toContain('方案预览');
    expect(container.querySelector('iframe[title="技术方案预览"]')).toBeTruthy();
  });

  it('offers a restart action after local preview has been stopped', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'DEMO_WAITING_CONFIRMATION',
        workflowRepositories: [
          {
            id: 'repo-1',
            repositoryId: 'repository-1',
            name: 'flowx-web',
            url: 'https://example.com/flowx-web.git',
            baseBranch: 'main',
            workingBranch: 'codex/demo-preview',
            status: 'READY',
            localPath: '/tmp/flowx-web',
          },
        ],
        stageExecutions: [
          {
            id: 'stage-grounding',
            stage: 'REPOSITORY_GROUNDING',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { repositories: [] },
          },
          {
            id: 'stage-demo',
            stage: 'DEMO',
            status: 'WAITING_CONFIRMATION',
            statusMessage: '请确认当前 Demo，再进入任务拆解',
            attempt: 1,
            output: {
              demoPages: [{ filePath: 'src/demo.tsx', componentName: 'DemoPanel', routePath: '/demo' }],
            },
          },
        ],
      }),
    );
    vi.mocked(api.detectLocalDev).mockResolvedValue({ command: 'pnpm dev', packageManager: 'pnpm' } as never);
    vi.mocked(api.getLocalDevStatus)
      .mockResolvedValueOnce({
        status: 'running',
        running: true,
        previewUrl: 'http://127.0.0.1:4173',
        port: 4173,
        command: 'pnpm dev',
        logTail: '',
        lastError: null,
      } as never)
      .mockResolvedValueOnce({
        status: 'stopped',
        running: false,
        previewUrl: null,
        port: 4173,
        command: 'pnpm dev',
        logTail: '',
        lastError: null,
      } as never);
    vi.mocked(api.stopLocalDevPreview).mockResolvedValue(undefined as never);
    vi.mocked(api.startLocalDevPreview).mockResolvedValue({ ok: true } as never);

    await renderPage();

    const demoStepButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Demo 页面'),
    );

    await act(async () => {
      demoStepButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const stopButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('停止本地预览'),
    );

    await act(async () => {
      stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const restartButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('启动本地预览'),
    );

    expect(restartButton).toBeTruthy();

    await act(async () => {
      restartButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.startLocalDevPreview).toHaveBeenCalledWith('repository-1', 'workflow-1');
  });

  it('claims local execution and launches Cursor through flowx-local', async () => {
    const localExecution = createWorkflowRun({
      status: 'EXECUTION_RUNNING',
      stageExecutions: [
        {
          id: 'execution-1',
          stage: 'EXECUTION',
          status: 'RUNNING',
          statusMessage: null,
          attempt: 1,
          input: { executor: 'LOCAL' },
          output: null,
        },
      ],
    });
    vi.mocked(api.getWorkflowRun)
      .mockResolvedValueOnce(
        createWorkflowRun({
          status: 'EXECUTION_PENDING',
          stageExecutions: [
            {
              id: 'execution-1',
              stage: 'EXECUTION',
              status: 'PENDING',
              statusMessage: null,
              attempt: 0,
              output: null,
            },
          ],
        }),
      )
      .mockResolvedValue(localExecution);
    vi.mocked(api.claimLocalExecution).mockResolvedValue({
      workflow: localExecution,
      handoff: { repositories: [] },
    } as never);
    vi.mocked(api.issueLocalLaunchTicket).mockResolvedValue({
      ticket: 'ticket-1',
      expiresAt: '2026-07-16T12:00:00.000Z',
      loopbackPort: 3920,
    });
    vi.mocked(api.getLocalHandoff).mockResolvedValue({ repositories: [] } as never);
    probeFlowxLocal.mockResolvedValue(true);
    launchFlowxLocal.mockResolvedValue({
      ok: true,
      gitRoot: '/tmp/flowx',
      ide: 'cursor',
      prefilled: true,
      promptPath: '/tmp/flowx/.flowx/prompt.md',
    });

    await renderPage();

    const executionStep = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('开发执行'),
    );
    await act(async () => {
      executionStep?.click();
      await Promise.resolve();
    });

    const launchButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '本地启动',
    );
    expect(launchButton).toBeTruthy();

    await act(async () => {
      launchButton?.click();
      await Promise.resolve();
    });

    const cursorButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cursor',
    );
    expect(cursorButton).toBeTruthy();

    await act(async () => {
      cursorButton?.click();
      await Promise.resolve();
    });

    expect(api.claimLocalExecution).toHaveBeenCalledWith('workflow-1');
    expect(api.issueLocalLaunchTicket).toHaveBeenCalledWith('workflow-1');
    expect(probeFlowxLocal).toHaveBeenCalledWith(3920);
    expect(launchFlowxLocal).toHaveBeenCalledWith(
      { ticket: 'ticket-1', ide: 'cursor', apiBaseUrl: 'http://127.0.0.1:3000' },
      3920,
    );
  });

  it('shows npm install instructions for local agent setup', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'EXECUTION_RUNNING',
        stageExecutions: [
          {
            id: 'execution-1',
            stage: 'EXECUTION',
            status: 'RUNNING',
            statusMessage: null,
            attempt: 1,
            input: { executor: 'LOCAL' },
            output: null,
          },
        ],
      }),
    );
    vi.mocked(api.getLocalHandoff).mockResolvedValue({
      repositories: [
        {
          workflowRepositoryId: 'repo-1',
          name: 'flowx-web',
          workingBranch: 'codex/fix-login',
          baseBranch: 'main',
          suggestedCommitMessage: 'fix: login error handling',
          checkout: {
            fetch: 'git fetch origin',
            checkout: 'git checkout codex/fix-login',
            push: 'git push origin codex/fix-login',
          },
        },
      ],
    } as never);

    await renderPage();

    const executionStep = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('开发执行'),
    );
    await act(async () => {
      executionStep?.click();
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });

    const text = container.textContent ?? '';
    expect(text).toContain('本地执行指引');
    expect(text).toContain('npm install -g @flowx-ai/local');
    expect(text).toContain('flowx-local serve');
    expect(text).not.toContain('pnpm --filter flowx-local');
  });

  it('shows the execution session panel when a local handoff provides a session id', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'EXECUTION_RUNNING',
        stageExecutions: [
          {
            id: 'execution-1',
            stage: 'EXECUTION',
            status: 'RUNNING',
            statusMessage: null,
            attempt: 1,
            input: { executor: 'LOCAL' },
            output: null,
          },
        ],
      }),
    );
    vi.mocked(api.getLocalHandoff).mockResolvedValue({
      executionSessionId: 'session-1',
      repositories: [],
    } as never);
    vi.mocked(api.getExecutionSession).mockResolvedValue({
      id: 'session-1',
      workflowRunId: 'workflow-1',
      status: 'RUNNING',
      executorType: 'LOCAL',
      sourceTool: 'cursor',
      protocolVersion: '1.0',
      traceId: 'trace-123',
      createdAt: '2026-07-23T07:00:00.000Z',
      updatedAt: '2026-07-23T08:00:00.000Z',
    });
    vi.mocked(api.listExecutionSessionEvidence).mockResolvedValue([]);
    vi.mocked(api.listExecutionSessionEvents).mockResolvedValue({ items: [], nextCursor: null });

    await renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('执行会话');
    expect(api.getExecutionSession).toHaveBeenCalledWith('session-1');
    expect(api.listExecutionSessionEvidence).toHaveBeenCalledWith('session-1');
  });

  it('hides the execution session panel when the local handoff has no session id', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'EXECUTION_RUNNING',
        stageExecutions: [
          {
            id: 'execution-1',
            stage: 'EXECUTION',
            status: 'RUNNING',
            statusMessage: null,
            attempt: 1,
            input: { executor: 'LOCAL' },
            output: null,
          },
        ],
      }),
    );
    vi.mocked(api.getLocalHandoff).mockResolvedValue({ repositories: [] } as never);

    await renderPage();
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('执行会话');
    expect(api.getExecutionSession).not.toHaveBeenCalled();
  });
});
