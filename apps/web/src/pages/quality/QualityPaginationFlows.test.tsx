// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { TestRequest } from '../../types';
import { QualityCreateRunDialog } from './QualityCreateRunDialog';
import { QualityReportsPanel } from './QualityReportsPanel';
import { pageResult } from './page-result-test';

vi.mock('../../api', () => ({ api: { getTestRequestSnapshots: vi.fn(), getTestRunCases: vi.fn(), createLocalTestRun: vi.fn(), getQualityReports: vi.fn(), getTestRuns: vi.fn(), getQualityReportBaselines: vi.fn(), getQualityReportSupersessions: vi.fn(), createQualityRequestReport: vi.fn() } }));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
let root: Root; let container: HTMLDivElement;
const request = { id: 'request-1' } as TestRequest;
const snapshot = (id: string) => ({ id, title: id, priority: 'P1', steps: ['执行'], expected: '成功', selectedBy: 'USER', targetKeys: ['web'] });
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.mocked(api.getTestRequestSnapshots).mockImplementation(async (_id, query) => pageResult([snapshot(`case-${query?.page ?? 1}`)], { total: 21, totalPages: 2, page: query?.page ?? 1 }));
  vi.mocked(api.createLocalTestRun).mockResolvedValue({ id: 'created', name: '轮次', runType: 'INITIAL', status: 'ACTIVE' });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
async function button(text: string, scope: ParentNode = document) { await act(async () => Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === text && !item.disabled)?.click()); }
async function check(label: string) { await act(async () => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.click()); }

it('创建轮次不把首屏预选当全范围，跨页仅提交明确勾选项', async () => {
  await act(async () => root.render(<QualityCreateRunDialog open onOpenChange={vi.fn()} request={request} onCreated={vi.fn()} />));
  expect(document.querySelector<HTMLInputElement>('input[aria-label="case-1 适用 Web"]')?.checked).toBe(false);
  await button('创建本地轮次');
  expect(api.createLocalTestRun).not.toHaveBeenCalled();
  await check('case-1 适用 Web'); await button('下一页'); await check('case-2 适用 Web'); await button('创建本地轮次');
  expect(api.createLocalTestRun).toHaveBeenCalledWith('request-1', expect.objectContaining({ cases: [{ snapshotId: 'case-1', targetKeys: ['web'] }, { snapshotId: 'case-2', targetKeys: ['web'] }] }));
});

it('缺陷回归按bugId跨页加载原执行项，页外目标仍可选择', async () => {
  vi.mocked(api.getTestRunCases).mockImplementation(async (_id, query) => pageResult([{ id: `row-${query?.page ?? 1}`, snapshot: snapshot(`bug-case-${query?.page ?? 1}`), target: { id: 'outside-target-page', key: 'api', name: 'API' } }], { total: 21, totalPages: 2, page: query?.page ?? 1 }));
  await act(async () => root.render(<QualityCreateRunDialog open onOpenChange={vi.fn()} request={request} sourceBugId="bug-1" sourceRunId="source-run" onCreated={vi.fn()} />));
  expect(api.getTestRunCases).toHaveBeenCalledWith('source-run', expect.objectContaining({ bugId: 'bug-1', page: 1, pageSize: 20 }));
  await check('bug-case-1 适用 API'); await button('下一页'); await check('bug-case-2 适用 API'); await button('创建本地轮次');
  expect(api.createLocalTestRun).toHaveBeenCalledWith('request-1', expect.objectContaining({ sourceBugId: 'bug-1', cases: [{ snapshotId: 'bug-case-1', targetKeys: ['api'] }, { snapshotId: 'bug-case-2', targetKeys: ['api'] }] }));
});

it('报告轮次与基线跨页选择保留完整ID，切换轮次清除旧基线', async () => {
  vi.mocked(api.getQualityReports).mockResolvedValue(pageResult([]));
  vi.mocked(api.getTestRuns).mockImplementation(async (_id, query) => pageResult([{ id: `run-${query?.page ?? 1}`, name: `轮次${query?.page ?? 1}`, status: 'PASSED', runType: 'INITIAL' }], { total: 11, totalPages: 2, page: query?.page ?? 1 }));
  vi.mocked(api.getQualityReportBaselines).mockImplementation(async (_id, query) => pageResult([{ workflowRepositoryId: `repo-${query?.page ?? 1}`, branch: 'main', headSha: 'sha', role: 'IMPLEMENTATION' }], { total: 11, totalPages: 2, page: query?.page ?? 1 }));
  vi.mocked(api.getQualityReportSupersessions).mockResolvedValue(pageResult([]));
  vi.mocked(api.createQualityRequestReport).mockResolvedValue({} as never);
  await act(async () => root.render(<MemoryRouter><QualityReportsPanel requestId="request-1" runs={[]} /></MemoryRouter>));
  const runField = () => Array.from(container.querySelectorAll('fieldset')).find(field => field.querySelector('legend')?.textContent === '参与轮次')!;
  const baselineField = () => Array.from(container.querySelectorAll('fieldset')).find(field => field.querySelector('legend')?.textContent === '汇总代码基线')!;
  await act(async () => runField().querySelector<HTMLInputElement>('input')?.click()); await button('下一页', runField());
  await act(async () => runField().querySelector<HTMLInputElement>('input')?.click());
  await act(async () => baselineField().querySelector<HTMLInputElement>('input')?.click()); await button('下一页', baselineField());
  await act(async () => baselineField().querySelector<HTMLInputElement>('input')?.click()); await button('生成任务汇总报告');
  expect(api.createQualityRequestReport).toHaveBeenLastCalledWith('request-1', expect.objectContaining({ runIds: ['run-1', 'run-2'], baseline: [expect.objectContaining({ workflowRepositoryId: 'repo-1' }), expect.objectContaining({ workflowRepositoryId: 'repo-2' })] }));
  await act(async () => runField().querySelector<HTMLInputElement>('input')?.click());
  expect(Array.from(container.querySelectorAll('button')).find(item => item.textContent === '生成任务汇总报告')?.disabled).toBe(true);
});
