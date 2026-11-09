// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { pageResult } from './page-result-test';
import type { TestDesign } from '../../types';
import { QualityTestDesignPage } from './QualityTestDesignPage';

const { errorToast, successToast } = vi.hoisted(() => ({ errorToast: vi.fn(), successToast: vi.fn() }));

vi.mock('../../api', () => ({
  api: {
    getTestDesign: vi.fn(),
    getTestDesignWorkflows: vi.fn(),
    generateTestDesign: vi.fn(),
  },
}));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ error: errorToast, success: successToast }) }));

const baseDesign: TestDesign = {
  id: 'design-1', workspaceId: 'workspace-1', projectId: 'project-1', projectVersionId: 'version-1',
  status: 'WAITING_REVIEW', revision: 3, sourceFingerprint: 'fingerprint',
  sourceSummary: { requirementIds: ['requirement-1'], workflowRunIds: ['workflow-1'], designs: [{ title: '技术方案' }], specPlans: [{ title: '执行计划' }], changeSummary: '修改登录鉴权' },
  summary: { pendingCount: 2, acceptedCount: 0, smokePendingCount: 1, candidateCount: 8, smokeCount: 2 },
  uncoveredItems: ['异常登录提示'], candidates: [], smokeCases: [],
  requirements: [{ requirement: { id: 'requirement-1', title: '登录体验优化' } }],
  testRequest: null,
};

function renderPage() {
  return act(async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<MemoryRouter initialEntries={['/quality/test-designs/design-1']}><Routes><Route path="/quality/test-designs/:id" element={<QualityTestDesignPage />} /></Routes></MemoryRouter>);
    await Promise.resolve();
    await Promise.resolve();
    return { container, root };
  });
}

describe('QualityTestDesignPage', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(api.getTestDesign).mockResolvedValue(baseDesign);
    vi.mocked(api.getTestDesignWorkflows).mockResolvedValue(pageResult([{ workflowRun: { id: 'workflow-1', status: 'DONE' } }]));
    vi.mocked(api.generateTestDesign).mockResolvedValue({ ...baseDesign, status: 'GENERATING' });
    errorToast.mockReset();
    successToast.mockReset();
  });
  afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

  it('只展示 AI 来源和结果摘要，不再要求选择用例库或逐条确认', async () => {
    const { container, root } = await renderPage();
    expect(container.textContent).toContain('AI 测试分析');
    expect(container.textContent).toContain('这次 AI 看了什么');
    expect(container.textContent).toContain('分析结果');
    expect(container.textContent).toContain('功能候选');
    expect(container.textContent).toContain('8');
    expect(container.textContent).toContain('发起提测');
    expect(container.textContent).not.toContain('选择用例库');
    expect(container.textContent).not.toContain('选择用例范围');
    expect(container.textContent).not.toContain('处理建议与补选');
    expect(container.textContent).not.toContain('确认测试设计');
    expect(container.textContent).not.toContain('确认本页冒烟');
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('异常登录提示');
    act(() => root.unmount());
  });

  it('发起提测链接带入项目、版本、需求和研发工作流', async () => {
    const { container, root } = await renderPage();
    const link = Array.from(container.querySelectorAll('a')).find(item => item.textContent?.includes('发起提测'));
    expect(link?.getAttribute('href')).toContain('create=1');
    expect(link?.getAttribute('href')).toContain('projectId=project-1');
    expect(link?.getAttribute('href')).toContain('projectVersionId=version-1');
    expect(link?.getAttribute('href')).toContain('workflowRunId=workflow-1');
    act(() => root.unmount());
  });

  it('已有提测时只提供查看提测详情', async () => {
    vi.mocked(api.getTestDesign).mockResolvedValue({ ...baseDesign, status: 'CONFIRMED', testRequest: { id: 'request-1', title: '登录提测' } });
    const { container, root } = await renderPage();
    expect(container.textContent).toContain('查看提测详情');
    expect(container.querySelector('a[href="/quality/test-requests/request-1"]')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('a')).some(item => item.textContent?.includes('发起提测'))).toBe(false);
    act(() => root.unmount());
  });

  it('分析失败时显示诊断信息并允许重新分析', async () => {
    vi.mocked(api.getTestDesign).mockResolvedValue({ ...baseDesign, status: 'GENERATION_FAILED', generationError: 'AI 凭据不可用' });
    const { container, root } = await renderPage();
    expect(container.textContent).toContain('AI 凭据不可用');
    const retry = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('重新分析'));
    await act(async () => retry?.click());
    expect(api.generateTestDesign).toHaveBeenCalledWith('design-1');
    act(() => root.unmount());
  });
});
