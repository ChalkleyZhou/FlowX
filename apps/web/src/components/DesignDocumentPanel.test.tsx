// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DesignDocumentPanel } from './DesignDocumentPanel';

describe('DesignDocumentPanel', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    document.body.innerHTML = '';
  });

  it('shows an empty state when markdown is missing', async () => {
    await act(async () => {
      root?.render(<DesignDocumentPanel output={{ design: { overview: '不应合成正文' }, demo: {}, surfaces: [] }} />);
    });

    expect(container.textContent).toContain('尚未提交设计文档');
    expect(container.textContent).not.toContain('不应合成正文');
  });

  it('renders a non-empty markdown body', async () => {
    await act(async () => {
      root?.render(
        <DesignDocumentPanel
          output={{
            format: 'markdown',
            markdown: '# 设计文档\n\n这里是已确认的设计正文。',
            design: {},
            demo: {},
            surfaces: [],
          }}
        />,
      );
    });

    expect(container.textContent).toContain('设计文档');
    expect(container.textContent).toContain('这里是已确认的设计正文。');
    expect(container.querySelector('pre')?.className).toContain('whitespace-pre-wrap');
  });
});
