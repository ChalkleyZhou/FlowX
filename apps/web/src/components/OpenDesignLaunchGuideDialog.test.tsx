// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenDesignLaunchGuideDialog } from './OpenDesignLaunchGuideDialog';

describe('OpenDesignLaunchGuideDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders two steps and prompt copy when open', () => {
    act(() => {
      root.render(
        <OpenDesignLaunchGuideDialog
          open
          onOpenChange={() => undefined}
          onConfirm={() => undefined}
        />,
      );
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('如何在 OpenDesign 中获取 FlowX 任务');
    expect(text).toContain('选择项目目录（根据实际情况按需选择）');
    expect(text).toContain('输入“获取FlowX任务”并发送');
    expect(text).toContain('获取FlowX任务');
    expect(document.body.querySelector('img[alt*="选择项目目录"]')).toBeTruthy();
    expect(document.body.querySelector('img[alt*="获取FlowX任务"]')).toBeTruthy();
  });

  it('calls onConfirm when continue is clicked', () => {
    const onConfirm = vi.fn();
    act(() => {
      root.render(
        <OpenDesignLaunchGuideDialog
          open
          onOpenChange={() => undefined}
          onConfirm={onConfirm}
        />,
      );
    });
    const button = Array.from(document.body.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('继续打开 OpenDesign'),
    );
    expect(button).toBeTruthy();
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenChange(false) when cancel is clicked', () => {
    const onOpenChange = vi.fn();
    act(() => {
      root.render(
        <OpenDesignLaunchGuideDialog
          open
          onOpenChange={onOpenChange}
          onConfirm={() => undefined}
        />,
      );
    });
    const button = Array.from(document.body.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('取消'),
    );
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
