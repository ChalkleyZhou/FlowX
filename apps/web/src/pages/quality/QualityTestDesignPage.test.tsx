// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { TestDesign } from '../../types';
import { QualityTestDesignPage } from './QualityTestDesignPage';

const { errorToast, successToast } = vi.hoisted(() => ({
  errorToast: vi.fn(),
  successToast: vi.fn(),
}));

vi.mock('../../api', () => ({
  api: {
    getTestDesign: vi.fn(),
    generateTestDesign: vi.fn(),
    updateTestDesignCandidate: vi.fn(),
    updateTestDesignSmoke: vi.fn(),
    confirmTestDesign: vi.fn(),
  },
}));

vi.mock('../../components/ui/toast', () => ({
  useToast: () => ({ error: errorToast, success: successToast }),
}));

const design: TestDesign = {
  id: 'design-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  projectVersionId: 'version-1',
  status: 'WAITING_REVIEW',
  revision: 2,
  sourceFingerprint: 'fingerprint',
  sourceSummary: {},
  uncoveredItems: [],
  candidates: [{
    id: 'candidate-1',
    action: 'OPTIMIZE',
    resolution: 'PENDING',
    sourceDefinitionId: 'case-1',
    sourceVersion: 3,
    matchReason: '主流程相同，但需要补充错误提示校验',
    coverageKeys: ['login-error'],
    sourceDefinition: {
      id: 'case-1',
      libraryId: 'library-1',
      status: 'ACTIVE',
      version: 3,
      title: '登录失败',
      priority: 'P1',
      precondition: null,
      steps: ['输入错误密码'],
      expected: '登录失败',
      tags: [],
      library: {
        id: 'library-1',
        workspaceId: 'workspace-1',
        scope: 'WORKSPACE',
        name: '共享回归库',
        status: 'ACTIVE',
      },
    },
    proposedCase: {
      title: '登录失败展示明确原因',
      priority: 'P1',
      steps: ['输入错误密码', '提交登录'],
      expected: '展示明确错误原因',
      tags: ['登录'],
    },
  }],
  smokeCases: [{
    id: 'smoke-1',
    title: '登录主链路冒烟',
    priority: 'P0',
    precondition: null,
    steps: ['使用有效账号登录'],
    expected: '进入首页',
    blocking: true,
    coverageKeys: ['login-main'],
    resolution: 'PENDING',
  }],
};

describe('QualityTestDesignPage', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.getTestDesign).mockResolvedValue(design);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (root) act(() => root?.unmount());
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function renderPage() {
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/quality/test-designs/design-1']}>
          <Routes>
            <Route path="/quality/test-designs/:id" element={<QualityTestDesignPage />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('shows library origin and the existing/proposed case comparison', async () => {
    await renderPage();

    expect(container.textContent).toContain('Workspace 共享库');
    expect(container.textContent).toContain('优化现有用例');
    expect(container.textContent).toContain('现有用例');
    expect(container.textContent).toContain('建议结果');
    expect(container.textContent).toContain('展示明确错误原因');
    const confirmButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('确认测试设计'),
    );
    expect(confirmButton?.disabled).toBe(true);
  });

  it('submits candidate and smoke confirmations with the current revision', async () => {
    vi.mocked(api.updateTestDesignCandidate).mockResolvedValue(design.candidates[0]);
    vi.mocked(api.updateTestDesignSmoke).mockResolvedValue({
      ...design,
      revision: 3,
      smokeCases: design.smokeCases.map((item) => ({ ...item, resolution: 'ACCEPTED' })),
    });
    await renderPage();

    const acceptButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.trim() === '接受',
    );
    await act(async () => {
      acceptButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.updateTestDesignCandidate).toHaveBeenCalledWith('design-1', 'candidate-1', {
      revision: 2,
      resolution: 'ACCEPTED',
    });

    const smokeButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.trim() === '确认冒烟',
    );
    await act(async () => {
      smokeButton?.click();
      await Promise.resolve();
    });
    expect(api.updateTestDesignSmoke).toHaveBeenCalledWith('design-1', {
      revision: 2,
      cases: [expect.objectContaining({ id: 'smoke-1', resolution: 'ACCEPTED' })],
    });
  });

  it.each([
    ['本次不测', undefined, '本次不测'],
    ['纳入本次测试（复用）', 'REUSE', '已纳入'],
  ] as const)('makes the exclusion decision explicit when choosing %s', async (label, action, status) => {
    const candidate = {
      ...design.candidates[0],
      action: 'EXCLUDE' as const,
      matchReason: '本次只修改导出功能，登录流程不受影响',
    };
    vi.mocked(api.getTestDesign)
      .mockResolvedValueOnce({ ...design, candidates: [candidate] })
      .mockResolvedValue({
        ...design,
        candidates: [{ ...candidate, action: action ?? 'EXCLUDE', resolution: 'ACCEPTED' }],
      });
    await renderPage();

    const card = container.querySelector('article');
    expect(card?.textContent).toContain('AI 建议本次不测');
    expect(card?.textContent).toContain(`AI 建议不纳入的原因：${candidate.matchReason}`);
    expect(card?.querySelector('header [aria-label="处理状态"]')?.textContent).toBe('待处理');
    const button = Array.from(card?.querySelectorAll('button') ?? []).find((item) => item.textContent?.trim() === label);
    expect(button).toBeDefined();
    await act(async () => { button?.click(); });

    expect(api.updateTestDesignCandidate).toHaveBeenCalledWith('design-1', 'candidate-1', {
      revision: 2,
      resolution: 'ACCEPTED',
      ...(action ? { action } : {}),
    });
    expect(container.querySelector('article header [aria-label="处理状态"]')?.textContent).toBe(status);
    expect(container.querySelector('article button')).toBeNull();
  });

  it('identifies a missing exclusion reason and hides reuse without a source case', async () => {
    vi.mocked(api.getTestDesign).mockResolvedValue({
      ...design,
      candidates: [{ ...design.candidates[0], action: 'EXCLUDE', matchReason: null, sourceDefinitionId: null, sourceDefinition: null }],
    });
    await renderPage();

    expect(container.textContent).toContain('AI 未提供不纳入原因');
    expect(container.textContent).not.toContain('纳入本次测试（复用）');
  });

  it('polls while test design generation is running', async () => {
    vi.useFakeTimers();
    vi.mocked(api.generateTestDesign).mockResolvedValue({ ...design, status: 'GENERATING' });
    let finishPoll!: (value: TestDesign) => void;
    vi.mocked(api.getTestDesign)
      .mockResolvedValueOnce(design)
      .mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve; }));
    await renderPage();

    const generateButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('生成候选'),
    );
    await act(async () => {
      generateButton?.click();
      await Promise.resolve();
    });
    expect(successToast).toHaveBeenCalledWith('已开始后台生成测试用例，页面会自动刷新结果');

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(api.getTestDesign).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('生成中');
    expect(container.textContent).toContain('功能测试候选');
    expect(container.textContent).not.toContain('加载中');

    await act(async () => {
      finishPoll(design);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('待处理');
  });

  it('shows the persisted failure reason and clears it when retry starts', async () => {
    vi.mocked(api.getTestDesign).mockResolvedValueOnce({
      ...design, status: 'GENERATION_FAILED', generationError: 'AI 凭据无效，请更新组织凭据。',
    });
    vi.mocked(api.generateTestDesign).mockResolvedValue({
      ...design, status: 'GENERATING', generationError: null,
    });
    await renderPage();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('AI 凭据无效');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('排查编号：design-1');
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('生成候选'));
    await act(async () => { retry?.click(); await Promise.resolve(); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the failure reason when polling completes with an error', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getTestDesign)
      .mockResolvedValueOnce({ ...design, status: 'GENERATING' })
      .mockResolvedValueOnce({ ...design, status: 'GENERATION_FAILED', generationError: 'AI 生成超时，请稍后重试。' });
    await renderPage();

    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('AI 生成超时');
    expect(container.textContent).toContain('功能测试候选');
  });

  it('explains that older failures have no recorded reason', async () => {
    vi.mocked(api.getTestDesign).mockResolvedValueOnce({ ...design, status: 'GENERATION_FAILED' });
    await renderPage();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('本次失败未记录原因');
  });
});
