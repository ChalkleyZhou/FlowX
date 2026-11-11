// @vitest-environment jsdom
import { pageResult } from './page-result-test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { probeFlowxLocal, launchFlowxLocal } from '../../lib/flowx-local-bridge';
import type { TestRun } from '../../types';
import { QualityRunDetailPage } from './QualityRunDetailPage';
import { QualityReportsPanel } from './QualityReportsPanel';
import { QualityCreateRunDialog } from './QualityCreateRunDialog';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: {
    getTestRunCases: vi.fn(),
    getTestRunTargets: vi.fn(),
    getTestRunExecutions: vi.fn(),
    getTestRequestSnapshots: vi.fn(),
    getTestRuns: vi.fn(),
    getQualityReportBaselines: vi.fn(),
    getQualityReportSupersessions: vi.fn(),
    createLocalTestRun: vi.fn(),
    createTestRun: vi.fn(),
    getOrganizationMembers: vi.fn(),
    reportTestResult: vi.fn(),
    getTestRun: vi.fn(),
    getQualityReports: vi.fn(),
    createQualityRunReport: vi.fn(),
    createQualityRequestReport: vi.fn(),
    finishQualityRun: vi.fn(),
    controlQualityExecution: vi.fn(),
    fetchArtifactContent: vi.fn(),
    issueQualityLocalLaunchTicket: vi.fn(),
    getBugs: vi.fn(),
    createBug: vi.fn(),
    linkQualityCaseBug: vi.fn(),
  },
}));
vi.mock('../../lib/flowx-local-bridge', () => ({ probeFlowxLocal: vi.fn(), launchFlowxLocal: vi.fn() }));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

const run: TestRun = {
  id: 'run-1',
  name: '功能初测',
  runType: 'INITIAL',
  executionMode: 'LOCAL',
  revision: 3,
  status: 'ACTIVE',
  testPlan: {
    testRequest: { id: 'request-1', title: '认证提测', projectId: 'project-1', workspaceId: 'workspace-1' },
  },
  targets: [
    {
      id: 'web-1',
      key: 'web',
      name: 'Web',
      required: true,
      status: 'ACTIVE',
      expectedRevisions: [{ workflowRepositoryId: 'repo-1', branch: 'main', headSha: 'abc123' }],
    },
  ],
  cases: [
    {
      id: 'row-1',
      targetId: 'web-1',
      snapshot: {
        id: 'snapshot-1',
        title: '登录恢复',
        priority: 'P0',
        steps: ['登录'],
        expected: '回到原页面',
        selectedBy: 'MANUAL',
      },
      result: {
        id: 'result-1',
        result: 'FAILED',
        actualResult: '跳到了首页',
        evidence: { artifactIds: ['artifact-1'] },
      },
    },
  ],
  executions: [
    {
      id: 'execution-1',
      executionSessionId: 'session-1',
      targetId: 'web-1',
      claimedCaseIds: ['row-1'],
      claimedByUser: { displayName: '张三' },
      environment: { browser: 'Chrome' },
      testedRevisions: [{ workflowRepositoryId: 'repo-1', branch: 'main', headSha: 'abc123' }],
      status: 'RUNNING',
      startedAt: '2026-11-04T01:00:00Z',
      leaseExpiresAt: '2099-11-04T01:00:00Z',
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mockRunPages(value: TestRun) {
 vi.mocked(api.getTestRunCases).mockResolvedValue(pageResult(value.cases ?? [], { summary: { completedCount: value.cases?.filter(c => c.result).length ?? 0 } }));
 vi.mocked(api.getTestRunTargets).mockResolvedValue(pageResult(value.targets ?? []));
 vi.mocked(api.getTestRunExecutions).mockResolvedValue(pageResult(value.executions ?? [])); return value;
}
describe('质量执行与报告', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mockRunPages(run);
    vi.mocked(api.getTestRequestSnapshots).mockResolvedValue(pageResult(run.cases?.map(row => row.snapshot) ?? []));
    vi.mocked(api.getTestRuns).mockResolvedValue(pageResult([run]));
    vi.mocked(api.getQualityReportBaselines).mockResolvedValue(pageResult(run.targets?.flatMap(target => target.expectedRevisions) ?? []));
    vi.mocked(api.getQualityReportSupersessions).mockResolvedValue(pageResult([]));
    vi.mocked(probeFlowxLocal).mockResolvedValue(true);
    vi.mocked(launchFlowxLocal).mockResolvedValue({
      ok: true,
      gitRoot: '/repo',
      ide: 'codex',
      prefilled: true,
      promptPath: '/prompt',
      opened: true,
    });
    vi.mocked(api.issueQualityLocalLaunchTicket).mockResolvedValue({
      ticket: 'ticket-1',
      loopbackPort: 3920,
      expiresAt: '2099-01-01',
    });
    vi.clearAllMocks();
    vi.mocked(api.getTestRun).mockResolvedValue(mockRunPages(run));
    vi.mocked(api.getQualityReports).mockResolvedValue(pageResult([]));
    vi.mocked(api.getBugs).mockResolvedValue(pageResult([]));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  async function renderRun(extra?: React.ReactNode) {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/quality/test-runs/run-1']}>
          <Routes>
            <Route
              path="/quality/test-runs/:id"
              element={
                <>
                  {extra}
                  <QualityRunDetailPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>,
      ),
    );
  }
  it('创建轮次仅提交人工明确选择的快照到目标端映射', async () => {
    const request = { id: 'request-1', testPlan: { snapshots: [run.cases![0].snapshot] } } as Parameters<
      typeof QualityCreateRunDialog
    >[0]['request'];
    vi.mocked(api.createLocalTestRun).mockResolvedValue(run);
    await act(async () =>
      root.render(
        <MemoryRouter>
          <QualityCreateRunDialog open onOpenChange={vi.fn()} request={request} onCreated={vi.fn()} />
        </MemoryRouter>,
      ),
    );
    const web = container.ownerDocument.querySelector(
      'input[aria-label="登录恢复 适用 Web"]',
    ) as HTMLInputElement;
    expect(web.checked).toBe(false);
    await act(async () => web.click());
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((item) => item.textContent === '创建本地轮次')
        ?.click(),
    );
    expect(api.createLocalTestRun).toHaveBeenCalledWith(
      'request-1',
      expect.objectContaining({
        runType: 'INITIAL',
        cases: [{ snapshotId: 'snapshot-1', targetKeys: ['web'] }],
        targets: [{ key: 'web', name: 'Web', required: true, expectedRevisions: [] }],
      }),
    );
  });
  it('人工执行轮次选择执行人并把执行人透传到每条用例', async () => {
    const request = { id: 'request-1', testPlan: { snapshots: [run.cases![0].snapshot] } } as Parameters<
      typeof QualityCreateRunDialog
    >[0]['request'];
    vi.mocked(api.getOrganizationMembers).mockResolvedValue(pageResult([
      { id: 'tester-1', displayName: '张三', status: 'ACTIVE' },
    ]));
    vi.mocked(api.createTestRun).mockResolvedValue({ ...run, executionMode: 'MANUAL' });
    await act(async () =>
      root.render(
        <MemoryRouter>
          <QualityCreateRunDialog open onOpenChange={vi.fn()} request={request} onCreated={vi.fn()} />
        </MemoryRouter>,
      ),
    );
    const mode = document.querySelector('select[aria-label="执行方式"]') as HTMLSelectElement;
    await act(async () => {
      mode.value = 'MANUAL';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await choosePaged('执行人', '张三');
    await act(async () => {
      (document.querySelector('input[aria-label="登录恢复 适用 Web"]') as HTMLInputElement).click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((item) => item.textContent === '创建人工轮次')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createTestRun).toHaveBeenCalledWith('request-1', {
      name: '功能初测',
      runType: 'INITIAL',
      cases: [{ snapshotId: 'snapshot-1', assignedToUserId: 'tester-1' }],
    });
  });

  it('启动与筛选目标均可分页选择首页以外的目标', async () => {
    vi.mocked(api.getTestRunTargets).mockImplementation(async (_id, query) => pageResult([{ ...run.targets![0], id: `target-${query?.page ?? 1}`, key: query?.page === 2 ? 'api' : 'web', name: query?.page === 2 ? '后页API' : '首页Web' }], { page: query?.page ?? 1, total: 21, totalPages: 2 }));
    await renderRun();
    for (const label of ['启动目标端', '按目标端筛选']) {
      await act(async () => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click());
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      await act(async () => document.querySelector('[role="listbox"]')?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      expect(api.getTestRunTargets).toHaveBeenLastCalledWith('run-1', { page: 2, pageSize: 20, q: undefined });
      await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(item => item.textContent === '后页API')?.click());
      expect(document.querySelector(`button[aria-label="${label}"]`)?.textContent).toContain('后页API');
    }
    expect(api.getTestRunCases).toHaveBeenLastCalledWith('run-1', expect.objectContaining({ targetId: 'target-2' }));
  });
  it('人工执行详情可以回传逐例结果并刷新轮次', async () => {
    const manualRun: TestRun = {
      ...run,
      executionMode: 'MANUAL',
      cases: [{ ...run.cases![0], result: null }],
      executions: [],
    };
    vi.mocked(api.getTestRun).mockResolvedValue(mockRunPages(manualRun));
    vi.mocked(api.reportTestResult).mockResolvedValue({ result: { id: 'result-2', result: 'PASSED' }, runStatus: 'PASSED', testRequestStatus: 'PASSED' });
    await renderRun();
    await act(async () => {
      (document.querySelector('select[aria-label="测试结果 登录恢复"]') as HTMLSelectElement).value = 'PASSED';
      document.querySelector('select[aria-label="测试结果 登录恢复"]')?.dispatchEvent(new Event('change', { bubbles: true }));
      setInputValue(document.querySelector('input[aria-label="实际结果 登录恢复"]') as HTMLInputElement, '已回到原页面');
      Array.from(document.querySelectorAll('button')).find((item) => item.textContent === '保存结果：登录恢复')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.reportTestResult).toHaveBeenCalledWith('row-1', expect.objectContaining({ result: 'PASSED', actualResult: '已回到原页面' }));
  });
  it('逐例展示预期、实际、证据、实际版本与执行环境，并使用认证证据请求', async () => {
    await renderRun();
    for (const text of ['回到原页面', '跳到了首页', '张三', 'Chrome', 'abc123'])
      expect(container.textContent).toContain(text);
    vi.mocked(api.fetchArtifactContent).mockResolvedValue(new Blob(['证据'], { type: 'text/plain' }));
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent?.includes('查看证据'))
        ?.click(),
    );
    expect(api.fetchArtifactContent).toHaveBeenCalledWith('artifact-1');
  });
  it('后台轮询保留明细，延迟请求期间不会产生重叠请求', async () => {
    vi.useFakeTimers();
    await renderRun();
    const delayed = deferred<TestRun>();
    vi.mocked(api.getTestRun).mockReturnValueOnce(delayed.promise);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(container.textContent).toContain('跳到了首页');
    expect(api.getTestRun).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(api.getTestRun).toHaveBeenCalledTimes(2);
    await act(async () => delayed.resolve({ ...run, status: 'FAILED' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(api.getTestRun).toHaveBeenCalledTimes(2);
  });
  it('切换轮次后忽略旧轮次延迟回包', async () => {
    const old = deferred<TestRun>();
    vi.mocked(api.getTestRun).mockReturnValueOnce(old.promise);
    function Switch() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/quality/test-runs/run-2')}>切换轮次</button>;
    }
    await renderRun(<Switch />);
    vi.mocked(api.getTestRun).mockResolvedValue(mockRunPages({ ...run, id: 'run-2', name: '新轮次' }));
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent === '切换轮次')
        ?.click(),
    );
    await act(async () => old.resolve(run));
    expect(container.textContent).toContain('新轮次');
    expect(container.querySelector('.text-2xl')?.textContent).toBe('新轮次');
  });
  async function choosePaged(label: string, option: string) {
    await act(async () => { document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const candidate = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(item => item.textContent === option);
    expect(candidate).toBeTruthy();
    await act(async () => { candidate?.click(); });
  }
  async function launch() {
    await choosePaged('启动目标端', 'Web');
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent === '在本地打开测试任务')
        ?.click(),
    );
  }
  it('本地未安装时给出安装入口且不签发任务，启动成功只等待回传', async () => {
    await renderRun();
    vi.mocked(probeFlowxLocal).mockResolvedValueOnce(false);
    await launch();
    expect(container.textContent).toContain('未检测到 flowx-local');
    expect(api.issueQualityLocalLaunchTicket).not.toHaveBeenCalled();
    await launch();
    expect(api.issueQualityLocalLaunchTicket).toHaveBeenCalledWith('run-1', {
      targetId: 'web-1',
      preferredIde: 'codex',
    });
    expect(launchFlowxLocal).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: 'ticket-1', ide: 'codex', purpose: 'quality-test' }),
      3920,
    );
    expect(container.textContent).toContain('IDE 已打开，等待实际测试进度回传');
    expect(api.finishQualityRun).not.toHaveBeenCalled();
  });
  it.each(['本地尚未登录', '仓库尚未映射', '代码基线不匹配'])(
    '启动失败展示真实原因和可执行修复入口：%s',
    async (message) => {
      await renderRun();
      vi.mocked(launchFlowxLocal).mockRejectedValueOnce(new Error(message));
      await launch();
      expect(container.textContent).toContain(message);
      expect(container.querySelector('a[href="/local-agent"]')).not.toBeNull();
      expect(api.finishQualityRun).not.toHaveBeenCalled();
    },
  );
  it('取消须填写原因，并明确说明设备可能仍在运行', async () => {
    await renderRun();
    const input = container.querySelector('input[aria-label="控制原因 execution-1"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '终止旧任务');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    vi.mocked(api.controlQualityExecution).mockResolvedValue({ status: 'CANCELLED', deviceStopped: false });
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent === '取消会话')
        ?.click(),
    );
    expect(api.controlQualityExecution).toHaveBeenCalledWith('session-1', 'cancel', { reason: '终止旧任务' });
    expect(container.textContent).toContain('设备进程可能仍在运行');
  });
  it('失败轮次也能生成阶段报告，生成不会结束轮次', async () => {
    vi.mocked(api.getTestRun).mockResolvedValue(mockRunPages({ ...run, status: 'FAILED' }));
    await renderRun();
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent === '生成阶段报告')
        ?.click(),
    );
    expect(api.createQualityRunReport).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ mode: 'PROGRESS', idempotencyKey: expect.any(String) }),
    );
    expect(api.finishQualityRun).not.toHaveBeenCalled();
  });
  it('任务汇总只提交明确选中的轮次、代码基线和回归替代范围', async () => {
    const initial: TestRun = { ...run, status: 'FAILED', cases: run.cases!.map(row => ({ ...row, result: { ...row.result!, bugId: 'bug-1' } })) };
    const regression: TestRun = { ...run, id: 'run-2', name: '独立回归', status: 'PASSED', runType: 'REGRESSION', sourceBug: { id: 'bug-1', title: '跳转错误', fixWorkflowRun: { status: 'DONE' } }, cases: run.cases!.map(row => ({ ...row, id: 'regression-row-1', result: { id: 'regression-result', result: 'PASSED' } })) };
    vi.mocked(api.getTestRuns).mockResolvedValue(pageResult([initial, regression]));
    vi.mocked(api.getQualityReportSupersessions).mockResolvedValue(pageResult([{ previousRunId: 'run-1', regressionRunId: 'run-2', testRunCaseIds: ['row-1'], label: '功能初测 / 登录恢复 → 独立回归' }]));
    await act(async () => root.render(<MemoryRouter><QualityReportsPanel requestId="request-1" runs={[initial, regression]} /></MemoryRouter>));
    const check = async (prefix: string) => {
      const label = Array.from(container.querySelectorAll('label')).find(label => label.textContent?.trim().startsWith(prefix));
      await act(async () => (label?.querySelector('input') as HTMLInputElement).click());
    };
    await check('功能初测 · FAILED'); await check('独立回归 · PASSED'); await check('repo-1 · main · abc123');
    await check('功能初测 / 登录恢复 → 独立回归');
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '生成任务汇总报告')?.click());
    expect(api.createQualityRequestReport).toHaveBeenCalledWith('request-1', {
      idempotencyKey: expect.any(String), mode: 'PROGRESS', runIds: ['run-1', 'run-2'], baseline: [{ workflowRepositoryId: 'repo-1', branch: 'main', headSha: 'abc123' }],
      supersessions: [{ previousRunId: 'run-1', regressionRunId: 'run-2', testRunCaseIds: ['row-1'] }],
    });
  });
  it('报告列表区分轮次和任务汇总，并使用认证预览和下载', async () => {
    vi.mocked(api.getQualityReports).mockResolvedValue(pageResult([
      {
        id: 'report-1',
        requestId: 'request-1',
        runId: 'run-1',
        kind: 'RUN',
        mode: 'PROGRESS',
        summary: { conclusion: 'FAILED', total: 1, passed: 0, failed: 1, blocked: 0, skipped: 0, pending: 0, completed: 1, passRate: 0, completionRate: 1 },
        revision: 2,
        artifactId: 'artifact-report',
        createdAt: '2026-11-04T01:00:00Z',
        snapshot: {
          mode: 'PROGRESS',
          summary: {
            conclusion: 'FAILED',
            total: 1,
            passed: 0,
            failed: 1,
            blocked: 0,
            skipped: 0,
            pending: 0,
            completionRate: 1,
            passRate: 0,
          },
          runs: [],
          baseline: [{ workflowRepositoryId: 'repo-1', branch: 'main', headSha: 'abc123' }],
        },
        artifact: {
          id: 'artifact-report',
          name: 'report.html',
          artifactType: 'TEST_REPORT',
          version: '2',
          createdAt: '2026-11-04T01:00:00Z',
        },
      },
    ]));
    await act(async () =>
      root.render(
        <MemoryRouter>
          <QualityReportsPanel requestId="request-1" runs={[]} />
        </MemoryRouter>,
      ),
    );
    expect(container.textContent).toContain('轮次报告');
    expect(container.textContent).toContain('阶段报告');
    expect(container.textContent).toContain('FAILED');
    vi.mocked(api.fetchArtifactContent).mockResolvedValue(
      new Blob(['<h1>测试报告</h1>'], { type: 'text/html' }),
    );
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent === '在线查看')
        ?.click(),
    );
    expect(api.fetchArtifactContent).toHaveBeenCalledWith('artifact-report');
  });
});
