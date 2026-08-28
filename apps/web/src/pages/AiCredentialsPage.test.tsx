// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCredentialsPage } from './AiCredentialsPage';
import { ConfirmProvider } from '../components/ConfirmDialog';

const { errorToastSpy } = vi.hoisted(() => ({
  errorToastSpy: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getCursorCredentialStatus: vi.fn(),
    getCodexCredentialStatus: vi.fn(),
    upsertCursorCredential: vi.fn(),
    deleteCursorCredential: vi.fn(),
    upsertCodexCredential: vi.fn(),
    deleteCodexCredential: vi.fn(),
  },
}));

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorToastSpy,
  }),
}));

describe('AiCredentialsPage', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { api } = await import('../api');
    vi.mocked(api.getCursorCredentialStatus).mockResolvedValue({ provider: 'cursor', configured: false });
    vi.mocked(api.getCodexCredentialStatus).mockResolvedValue({ provider: 'codex', configured: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    errorToastSpy.mockReset();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('explains where to obtain Cursor and OpenAI API keys', async () => {
    await act(async () => {
      root?.render(
        <ConfirmProvider>
          <AiCredentialsPage />
        </ConfirmProvider>,
      );
      await Promise.resolve();
    });

    const helpButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '如何获取',
    );
    expect(helpButton).toBeTruthy();

    await act(async () => {
      helpButton?.click();
    });

    const dialogText = document.body.textContent ?? '';
    expect(dialogText).toContain('获取 AI 凭据');
    expect(dialogText).toContain('Cursor Dashboard');
    expect(dialogText).toContain('OpenAI Platform');

    const cursorLink = document.body.querySelector<HTMLAnchorElement>(
      'a[href="https://cursor.com/dashboard?tab=integrations"]',
    );
    const openAiLink = document.body.querySelector<HTMLAnchorElement>(
      'a[href="https://platform.openai.com/api-keys"]',
    );
    expect(cursorLink?.target).toBe('_blank');
    expect(cursorLink?.rel).toContain('noopener');
    expect(openAiLink?.target).toBe('_blank');
    expect(openAiLink?.rel).toContain('noopener');
  });
});
