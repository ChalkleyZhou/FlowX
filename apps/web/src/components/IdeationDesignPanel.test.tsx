// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeationDesignPanel } from './IdeationDesignPanel';
import { api } from '../api';
import type { IdeationSession } from '../types';

vi.mock('../api', () => ({
  api: {
    getDemoDeployStatus: vi.fn(),
    startDesign: vi.fn(),
    reviseDesign: vi.fn(),
    confirmDesign: vi.fn(),
  },
}));

describe('IdeationDesignPanel', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  const waitingSession: IdeationSession = {
    id: 'design-1',
    stage: 'DESIGN',
    attempt: 1,
    status: 'WAITING_CONFIRMATION',
    statusMessage: null,
    input: null,
    output: {
      design: {
        overview: '统一登录页、错误提示和测试视角。',
        pages: [
          {
            name: '登录页',
            route: '/login',
            layout: '顶部标题\n中部表单\n底部帮助入口',
            keyComponents: ['账号输入框', '密码输入框'],
            interactions: ['失败后保留输入并高亮错误'],
          },
        ],
        demoScenario: '输入错误密码，观察错误提示与重试流程。',
        dataModels: ['LoginAttempt'],
        apiEndpoints: [{ method: 'POST', path: '/api/login', purpose: '提交登录请求' }],
        designRationale: '先保障失败链路可见，再谈体验优化。',
      },
    },
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-04-20T00:00:00.000Z',
  };

  async function renderPanel() {
    await act(async () => {
      root?.render(
        <IdeationDesignPanel
          requirementId="req-1"
          ideationStatus="DESIGN_WAITING_CONFIRMATION"
          sessions={[waitingSession]}
          repositories={[]}
          onUpdated={() => undefined}
        />,
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

  it('keeps revise and confirm actions inside a persistent review sidebar for design confirmation', async () => {
    await renderPanel();

    const text = container.textContent ?? '';
    expect(text).toContain('反馈面板');
    expect(text).toContain('确认当前设计');
    expect(text).toContain('发送修改意见');

    const quoteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === '引用到反馈: 设计方案 / 页面设计',
    );

    expect(quoteButton).toBeTruthy();

    await act(async () => {
      quoteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('已引用');
    expect(container.textContent).toContain('设计方案 / 页面设计');
  });

  it('clears the draft and quoted section after sending design feedback successfully', async () => {
    vi.mocked(api.reviseDesign).mockResolvedValue({} as never);
    const onUpdated = vi.fn();

    await act(async () => {
      root?.render(
        <IdeationDesignPanel
          requirementId="req-1"
          ideationStatus="DESIGN_WAITING_CONFIRMATION"
          sessions={[waitingSession]}
          repositories={[]}
          onUpdated={onUpdated}
        />,
      );
    });

    const quoteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === '引用到反馈: 设计方案 / 页面设计',
    );

    await act(async () => {
      quoteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '把交互说明改成更偏测试检查项');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送修改意见',
    );
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.reviseDesign).toHaveBeenCalledWith('req-1', expect.stringContaining('把交互说明改成更偏测试检查项'));
    expect((container.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('');
    expect(container.textContent).not.toContain('已引用');
    expect(onUpdated).toHaveBeenCalled();
  });
});
