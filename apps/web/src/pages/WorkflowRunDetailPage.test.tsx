// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRunDetailPage } from './WorkflowRunDetailPage';
import { api } from '../api';
import { ConfirmProvider } from '../components/ConfirmDialog';
import type { SpecPlanOutput, WorkflowRun } from '../types';

vi.mock('../api', () => ({
  api: {
    getWorkflowRun: vi.fn(),
    runSpecPlan: vi.fn(),
    reviseSpecPlan: vi.fn(),
    confirmSpecPlan: vi.fn(),
    rejectSpecPlan: vi.fn(),
    manualEditSpecPlan: vi.fn(),
    runBrainstorm: vi.fn(),
    runDesign: vi.fn(),
    reviseWorkflowDesign: vi.fn(),
    confirmWorkflowDesign: vi.fn(),
    rejectWorkflowDesign: vi.fn(),
    skipBrainstorm: vi.fn(),
    skipDesign: vi.fn(),
    detectLocalDev: vi.fn(),
    getLocalDevStatus: vi.fn(),
    startLocalDevPreview: vi.fn(),
    stopLocalDevPreview: vi.fn(),
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
    rollbackWorkflowToPreviousStage: vi.fn(),
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

  const sampleSpecPlanOutput: SpecPlanOutput = {
    spec: {
      goal: '修复登录流程',
      scope: ['登录错误提示', '重试能力'],
      nonGoals: ['重构鉴权模块'],
      acceptanceCriteria: ['登录失败时展示明确原因'],
      constraints: [],
    },
    plan: {
      approach: '补齐前端错误提示与后端审计日志',
      touchpoints: ['apps/web/src/pages/LoginPage.tsx'],
      sequence: ['定位失败路径', '补 UI 提示', '补日志'],
      risks: [],
      verification: ['手动复现登录失败'],
    },
    notes: {
      checklist: ['确认文案'],
      openQuestions: [],
    },
  };

  function createWorkflowRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
    return {
      id: 'workflow-1',
      status: 'SPEC_PLAN_PENDING',
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
          stage: 'SPEC_PLAN',
          status: 'PENDING',
          statusMessage: null,
          attempt: 1,
          output: sampleSpecPlanOutput,
        },
      ],
      ...overrides,
    };
  }

  async function renderPage() {
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/workflow-runs/workflow-1']}>
          <ConfirmProvider>
            <Routes>
              <Route path="/workflow-runs/:workflowRunId" element={<WorkflowRunDetailPage />} />
            </Routes>
          </ConfirmProvider>
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
    expect(text).toContain('回传 PRD');
    expect(text).toContain('AI 生成产品简报');
    expect(text).toContain('跳过构思');
    expect(text).toContain('设计方案');
    expect(text).toContain('Spec & Plan');
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

  async function selectBrainstormStep() {
    const stepButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('产品构思'),
    );
    expect(stepButton).toBeTruthy();
    await act(async () => {
      stepButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  }

  it('shows restart brainstorm on the brainstorm stage when workflow is in design', async () => {
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
            output: { markdown: '# Spec' },
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

    await renderPage();
    await selectBrainstormStep();

    const restartButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('重新构思'),
    );
    expect(restartButton).toBeTruthy();
    expect(restartButton?.disabled).toBe(false);
  });

  it('hides restart brainstorm when workflow is in brainstorm pending', async () => {
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

    await renderPage();

    const restartButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('重新构思'),
    );
    expect(restartButton).toBeFalsy();
  });

  it('calls rollback when restart brainstorm is confirmed', async () => {
    const initialRun = createWorkflowRun({
      status: 'DESIGN_WAITING_CONFIRMATION',
      stageExecutions: [
        {
          id: 'stage-brainstorm',
          stage: 'BRAINSTORM',
          status: 'COMPLETED',
          statusMessage: null,
          attempt: 1,
          output: { markdown: '# Spec' },
        },
        {
          id: 'stage-design',
          stage: 'DESIGN',
          status: 'WAITING_CONFIRMATION',
          statusMessage: null,
          attempt: 1,
          output: { html: '<div/>' },
        },
      ],
    });
    const postRollbackRun = createWorkflowRun({
      status: 'BRAINSTORM_PENDING',
      stageExecutions: [
        {
          id: 'stage-brainstorm-2',
          stage: 'BRAINSTORM',
          status: 'PENDING',
          statusMessage: '已回退到此阶段，请重新执行',
          attempt: 2,
          output: null,
        },
        {
          id: 'stage-design',
          stage: 'DESIGN',
          status: 'WAITING_CONFIRMATION',
          statusMessage: null,
          attempt: 1,
          output: { html: '<div/>' },
        },
      ],
    });
    vi.mocked(api.getWorkflowRun)
      .mockResolvedValueOnce(initialRun)
      .mockResolvedValue(postRollbackRun);
    vi.mocked(api.rollbackWorkflowToPreviousStage).mockResolvedValue(postRollbackRun);

    await renderPage();
    await selectBrainstormStep();

    const restartButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('重新构思'),
    );
    await act(async () => {
      restartButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const confirmButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.trim() === '确认',
    );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.rollbackWorkflowToPreviousStage).toHaveBeenCalledWith('workflow-1');
    expect(api.getWorkflowRun).toHaveBeenCalledTimes(2);

    const openLocalBrainstormButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('打开本地构思'),
    );
    expect(openLocalBrainstormButton).toBeTruthy();
    expect(openLocalBrainstormButton?.hasAttribute('disabled')).toBe(false);

    const brainstormStep = Array.from(container.querySelectorAll('.workflow-steps button')).find((button) =>
      button.textContent?.includes('产品构思'),
    );
    expect(brainstormStep?.firstElementChild?.className).toContain('border-primary/30');
  });

  it('shows OpenDesign guide before launching brainstorm and only launches on confirm', async () => {
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
    vi.mocked(api.retryOpenDesignBrainstormHandoff).mockResolvedValue({
      ticket: 'ticket-1',
      loopbackPort: 3847,
      workflow: createWorkflowRun({ status: 'BRAINSTORM_PENDING' }),
      handoff: { executionSessionId: 'session-1' } as never,
    });
    vi.mocked(probeFlowxLocal).mockResolvedValue(true);
    vi.mocked(launchOpenDesignLocal).mockResolvedValue({ opened: true });

    await renderPage();

    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('打开本地构思'),
    );
    expect(openButton).toBeTruthy();

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('如何在 OpenDesign 中获取 FlowX 任务');
    expect(launchOpenDesignLocal).not.toHaveBeenCalled();
    expect(api.retryOpenDesignBrainstormHandoff).not.toHaveBeenCalled();

    const confirmButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('继续打开 OpenDesign'),
    );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.retryOpenDesignBrainstormHandoff).toHaveBeenCalledWith('workflow-1');
    expect(probeFlowxLocal).toHaveBeenCalledWith(3847);
    expect(launchOpenDesignLocal).toHaveBeenCalledWith(
      { ticket: 'ticket-1', apiBaseUrl: 'http://127.0.0.1:3000' },
      3847,
    );
  });

  it('does not launch OpenDesign when guide is cancelled', async () => {
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
            output: {
              brief: {
                expandedDescription: 'Expanded',
                userStories: [],
                edgeCases: [],
                successMetrics: [],
                openQuestions: [],
                assumptions: [],
                outOfScope: [],
              },
            },
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

    await renderPage();

    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('打开本地 OpenDesign'),
    );
    expect(openButton).toBeTruthy();

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('如何在 OpenDesign 中获取 FlowX 任务');

    const cancelButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('取消'),
    );
    expect(cancelButton).toBeTruthy();

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(launchOpenDesignLocal).not.toHaveBeenCalled();
    expect(api.retryOpenDesignHandoff).not.toHaveBeenCalled();
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

  it('shows design markdown without the structured design field tree', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'DESIGN_WAITING_CONFIRMATION',
        stageExecutions: [
          {
            id: 'stage-design',
            stage: 'DESIGN',
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: {
              markdown: '# 设计文档\n\n这是已确认的设计正文。',
              design: { overview: '结构化概览（不应显示）' },
              demo: { summary: '结构化 Demo（不应显示）' },
              surfaces: [],
            },
          },
        ],
      }),
    );

    await renderPage();

    const text = container.textContent ?? '';
    expect(text).toContain('这是已确认的设计正文。');
    expect(text).not.toContain('结构化概览（不应显示）');
    expect(text).not.toContain('结构化 Demo（不应显示）');
  });

  it('shows a design document empty state when markdown is missing', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'DESIGN_WAITING_CONFIRMATION',
        stageExecutions: [
          {
            id: 'stage-design',
            stage: 'DESIGN',
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: {
              design: { overview: '结构化概览（不应显示）' },
              demo: {},
              surfaces: [],
            },
          },
        ],
      }),
    );

    await renderPage();

    const text = container.textContent ?? '';
    expect(text).toContain('尚未提交设计文档');
    expect(text).not.toContain('结构化概览（不应显示）');
  });


  it('renders structured Spec & Plan document sections', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'SPEC_PLAN_WAITING_CONFIRMATION',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'SPEC_PLAN',
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: sampleSpecPlanOutput,
          },
        ],
      }),
    );

    await renderPage();

    const text = container.textContent ?? '';
    expect(text).toContain('Spec · 目标');
    expect(text).toContain('修复登录流程');
    expect(text).toContain('Plan · 方案');
    expect(text).toContain('补齐前端错误提示与后端审计日志');
    expect(text).toContain('Notes · 检查项');
  });

  it('submits manual Spec & Plan edits through manualEditSpecPlan API', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'SPEC_PLAN_WAITING_CONFIRMATION',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'SPEC_PLAN',
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: sampleSpecPlanOutput,
          },
        ],
      }),
    );
    vi.mocked(api.manualEditSpecPlan).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const editButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('人工修改'),
    );
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();

    const editedOutput: SpecPlanOutput = {
      ...sampleSpecPlanOutput,
      spec: {
        ...sampleSpecPlanOutput.spec,
        goal: '修复登录流程（人工修订）',
      },
    };

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, JSON.stringify(editedOutput, null, 2));
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('保存人工修改'),
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.manualEditSpecPlan).toHaveBeenCalledWith('workflow-1', editedOutput);
  });

  it('confirms Spec & Plan and unlocks execution actions', async () => {
    const waitingRun = createWorkflowRun({
      status: 'SPEC_PLAN_WAITING_CONFIRMATION',
      stageExecutions: [
        {
          id: 'stage-1',
          stage: 'SPEC_PLAN',
          status: 'WAITING_CONFIRMATION',
          statusMessage: null,
          attempt: 1,
          output: sampleSpecPlanOutput,
        },
      ],
    });
    const executionReadyRun = createWorkflowRun({
      status: 'EXECUTION_PENDING',
      stageExecutions: [
        {
          id: 'stage-1',
          stage: 'SPEC_PLAN',
          status: 'COMPLETED',
          statusMessage: null,
          attempt: 1,
          output: sampleSpecPlanOutput,
        },
        {
          id: 'stage-2',
          stage: 'EXECUTION',
          status: 'PENDING',
          statusMessage: null,
          attempt: 1,
          output: null,
        },
      ],
    });

    vi.mocked(api.getWorkflowRun)
      .mockResolvedValueOnce(waitingRun)
      .mockResolvedValue(executionReadyRun);
    vi.mocked(api.confirmSpecPlan).mockResolvedValue(executionReadyRun);

    await renderPage();

    const confirmButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.trim() === '确认',
    );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.confirmSpecPlan).toHaveBeenCalledWith('workflow-1');

    const executionStep = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('开发执行'),
    );
    await act(async () => {
      executionStep?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const runExecutionButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('云端执行'),
    );
    expect(runExecutionButton).toBeTruthy();
    expect(runExecutionButton?.hasAttribute('disabled')).toBe(false);
  });

  it('routes design confirmation into Spec & Plan pending stage', async () => {
    const designWaitingRun = createWorkflowRun({
      status: 'DESIGN_WAITING_CONFIRMATION',
      stageExecutions: [
        {
          id: 'stage-brainstorm',
          stage: 'BRAINSTORM',
          status: 'COMPLETED',
          statusMessage: null,
          attempt: 1,
          output: { markdown: '# Spec' },
        },
        {
          id: 'stage-design',
          stage: 'DESIGN',
          status: 'WAITING_CONFIRMATION',
          statusMessage: null,
          attempt: 1,
          output: { html: '<div/>' },
        },
      ],
    });
    const specPlanPendingRun = createWorkflowRun({
      status: 'SPEC_PLAN_PENDING',
      stageExecutions: [
        {
          id: 'stage-brainstorm',
          stage: 'BRAINSTORM',
          status: 'COMPLETED',
          statusMessage: null,
          attempt: 1,
          output: { markdown: '# Spec' },
        },
        {
          id: 'stage-design',
          stage: 'DESIGN',
          status: 'COMPLETED',
          statusMessage: null,
          attempt: 1,
          output: { html: '<div/>' },
        },
        {
          id: 'stage-spec-plan',
          stage: 'SPEC_PLAN',
          status: 'PENDING',
          statusMessage: null,
          attempt: 1,
          output: null,
        },
      ],
    });

    vi.mocked(api.getWorkflowRun)
      .mockResolvedValueOnce(designWaitingRun)
      .mockResolvedValue(specPlanPendingRun);
    vi.mocked(api.confirmWorkflowDesign).mockResolvedValue(specPlanPendingRun);

    await renderPage();

    const designStep = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('设计方案'),
    );
    await act(async () => {
      designStep?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const confirmDesignButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('确认设计方案'),
    );
    expect(confirmDesignButton).toBeTruthy();

    await act(async () => {
      confirmDesignButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.confirmWorkflowDesign).toHaveBeenCalledWith('workflow-1');

    const specPlanStep = Array.from(container.querySelectorAll('.workflow-steps button')).find((button) =>
      button.textContent?.includes('Spec & Plan'),
    );
    expect(specPlanStep?.firstElementChild?.className).toContain('border-primary/30');

    const generateButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('生成 Spec & Plan'),
    );
    expect(generateButton).toBeTruthy();
    expect(generateButton?.hasAttribute('disabled')).toBe(false);
  });

  it('renders a persistent workflow review sidebar for waiting-confirmation stages', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'SPEC_PLAN_WAITING_CONFIRMATION',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'SPEC_PLAN',
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: sampleSpecPlanOutput,
          },
        ],
      }),
    );

    await renderPage();

    const text = container.textContent ?? '';
    expect(text).toContain('工作流反馈区');
    expect(text).toContain('发送修改意见');
    expect(text).toContain('人工修改');
  });

  it('clears workflow feedback after a successful revise submit', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'SPEC_PLAN_WAITING_CONFIRMATION',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'SPEC_PLAN',
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: sampleSpecPlanOutput,
          },
        ],
      }),
    );
    vi.mocked(api.reviseSpecPlan).mockResolvedValue(createWorkflowRun());

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

    expect(api.reviseSpecPlan).toHaveBeenCalledWith('workflow-1', '把任务拆分成前后端两块');
    expect((container.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('');
  });

  it('disables Spec & Plan reject when feedback is empty', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'SPEC_PLAN_WAITING_CONFIRMATION',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'SPEC_PLAN',
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: sampleSpecPlanOutput,
          },
        ],
      }),
    );

    await renderPage();

    const rejectButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('驳回'),
    );
    expect(rejectButton).toBeTruthy();
    expect(rejectButton?.disabled).toBe(true);
  });

  it('submits Spec & Plan rejection with feedback body', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'SPEC_PLAN_WAITING_CONFIRMATION',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'SPEC_PLAN',
            status: 'WAITING_CONFIRMATION',
            statusMessage: null,
            attempt: 1,
            output: sampleSpecPlanOutput,
          },
        ],
      }),
    );
    vi.mocked(api.rejectSpecPlan).mockResolvedValue(createWorkflowRun());

    await renderPage();

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '方案范围过大，需缩小');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const rejectButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('驳回'),
    );
    expect(rejectButton).toBeTruthy();
    expect(rejectButton?.disabled).toBe(false);

    await act(async () => {
      rejectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.rejectSpecPlan).toHaveBeenCalledWith('workflow-1', '方案范围过大，需缩小');
  });

  it('keeps stale review findings actionable while allowing manual rerun from human review pending', async () => {
    vi.mocked(api.getWorkflowRun).mockResolvedValue(
      createWorkflowRun({
        status: 'HUMAN_REVIEW_PENDING',
        stageExecutions: [
          {
            id: 'stage-1',
            stage: 'SPEC_PLAN',
            status: 'COMPLETED',
            statusMessage: null,
            attempt: 1,
            output: { tasks: ['补齐登录错误提示'] },
          },
          {
            id: 'stage-2',
            stage: 'SPEC_PLAN',
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
