// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeationBrainstormPanel } from './IdeationBrainstormPanel';
import { api } from '../api';
import type { IdeationSession } from '../types';

vi.mock('../api', () => ({
  api: {
    startBrainstorm: vi.fn(),
    reviseBrainstorm: vi.fn(),
    confirmBrainstorm: vi.fn(),
  },
}));

describe('IdeationBrainstormPanel', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  const waitingSession: IdeationSession = {
    id: 'brainstorm-1',
    stage: 'BRAINSTORM',
    attempt: 1,
    status: 'WAITING_CONFIRMATION',
    statusMessage: null,
    input: null,
    output: {
      brief: {
        expandedDescription: '把登录需求扩展为完整的产品简报。',
        userStories: [{ role: '测试工程师', action: '复核异常链路', benefit: '保证错误提示完整' }],
        edgeCases: ['网络抖动导致重复提交'],
        successMetrics: ['失败原因可见'],
        openQuestions: ['是否需要验证码兜底'],
        assumptions: ['先只覆盖 Web 端'],
        outOfScope: ['三方登录改造'],
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
        <IdeationBrainstormPanel
          requirementId="req-1"
          ideationStatus="BRAINSTORM_WAITING_CONFIRMATION"
          sessions={[waitingSession]}
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

  it('shows a persistent review panel and quoted section context while waiting for confirmation', async () => {
    await renderPanel();

    const text = container.textContent ?? '';
    expect(text).toContain('反馈面板');
    expect(text).toContain('确认当前简报');
    expect(text).toContain('发送修改意见');

    const quoteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === '引用到反馈: 头脑风暴 / 用户故事',
    );

    expect(quoteButton).toBeTruthy();

    await act(async () => {
      quoteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('已引用');
    expect(container.textContent).toContain('头脑风暴 / 用户故事');
  });

  it('clears the draft and quoted section after sending feedback successfully', async () => {
    vi.mocked(api.reviseBrainstorm).mockResolvedValue({} as never);
    const onUpdated = vi.fn();

    await act(async () => {
      root?.render(
        <IdeationBrainstormPanel
          requirementId="req-1"
          ideationStatus="BRAINSTORM_WAITING_CONFIRMATION"
          sessions={[waitingSession]}
          onUpdated={onUpdated}
        />,
      );
    });

    const quoteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === '引用到反馈: 头脑风暴 / 用户故事',
    );

    await act(async () => {
      quoteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();

    await act(async () => {
      textarea!.dispatchEvent(new FocusEvent('focus'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '把这个用户故事拆细一点');
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

    expect(api.reviseBrainstorm).toHaveBeenCalledWith('req-1', expect.stringContaining('把这个用户故事拆细一点'));
    expect((container.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('');
    expect(container.textContent).not.toContain('已引用');
    expect(onUpdated).toHaveBeenCalled();
  });
});
