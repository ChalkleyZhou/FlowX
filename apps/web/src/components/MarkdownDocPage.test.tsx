// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownDocPage } from './MarkdownDocPage';
import { ThemeProvider } from './theme-provider';

describe('MarkdownDocPage', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  const fetchMock = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders markdown and keeps internal paths in-app', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('# 标题\n\n见 [本地 Agent](/local-agent)。').buffer,
    });

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <ThemeProvider>
            <MarkdownDocPage
              markdownUrl="/local-agent-guide.md"
              eyebrow="Local Agent"
              title="本地 Agent"
              description="guide"
            />
          </ThemeProvider>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith('/local-agent-guide.md', { cache: 'no-store' });
    expect(container.textContent).toContain('本地 Agent');
    expect(container.textContent).toContain('标题');

    const internalLink = Array.from(container.querySelectorAll('a')).find(
      (link) => link.getAttribute('href') === '/local-agent',
    );
    expect(internalLink).toBeTruthy();
    expect(internalLink?.getAttribute('target')).toBeNull();
  });
});
