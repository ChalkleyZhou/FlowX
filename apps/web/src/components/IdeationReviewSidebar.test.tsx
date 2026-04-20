// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeationReviewSidebar } from './IdeationReviewSidebar';

describe('IdeationReviewSidebar', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  function renderSidebar(feedback: string, activeAction: 'confirm' | 'revise' | null = null) {
    return act(async () => {
      root?.render(
        <IdeationReviewSidebar
          stageLabel="头脑风暴"
          feedback={feedback}
          selectedSection={null}
          loading={false}
          activeAction={activeAction}
          confirmLabel="确认当前简报"
          reviseLabel="发送修改意见"
          onFeedbackChange={() => undefined}
          onClearSection={() => undefined}
          onConfirm={() => undefined}
          onRevise={() => undefined}
        />,
      );
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

  it('keeps confirmation primary when there is no feedback draft', async () => {
    await renderSidebar('');

    const actions = Array.from(container.querySelectorAll('button[data-action-role]'));
    const primary = container.querySelector('button[data-action-role="primary"]');
    const secondary = container.querySelector('button[data-action-role="secondary"]');

    expect(actions[0]?.textContent?.trim()).toBe('发送修改意见');
    expect(actions[1]?.textContent?.trim()).toBe('确认当前简报');
    expect(primary?.textContent?.trim()).toBe('确认当前简报');
    expect(secondary?.textContent?.trim()).toBe('发送修改意见');
    expect(actions[0]?.hasAttribute('disabled')).toBe(true);
  });

  it('promotes sending feedback to the primary action when there is a draft', async () => {
    await renderSidebar('把用户故事拆得再细一点');

    const actions = Array.from(container.querySelectorAll('button[data-action-role]'));
    const primary = container.querySelector('button[data-action-role="primary"]');
    const secondary = container.querySelector('button[data-action-role="secondary"]');

    expect(actions[0]?.textContent?.trim()).toBe('发送修改意见');
    expect(actions[1]?.textContent?.trim()).toBe('确认当前简报');
    expect(primary?.textContent?.trim()).toBe('发送修改意见');
    expect(secondary?.textContent?.trim()).toBe('确认当前简报');
    expect(primary?.hasAttribute('disabled')).toBe(false);
  });

  it('shows processing text only on the action that is running', async () => {
    await renderSidebar('把用户故事拆得再细一点', 'revise');

    const actions = Array.from(container.querySelectorAll('button[data-action-role]'));
    expect(actions[0]?.textContent?.trim()).toBe('处理中...');
    expect(actions[1]?.textContent?.trim()).toBe('确认当前简报');

    await renderSidebar('', 'confirm');

    const confirmActions = Array.from(container.querySelectorAll('button[data-action-role]'));
    expect(confirmActions[0]?.textContent?.trim()).toBe('发送修改意见');
    expect(confirmActions[1]?.textContent?.trim()).toBe('处理中...');
  });
});
