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
});
