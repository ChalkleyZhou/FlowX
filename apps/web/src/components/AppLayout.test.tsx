// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';
import { ThemeProvider } from './theme-provider';
import { api } from '../api';

const { logoutSpy, navigateSpy } = vi.hoisted(() => ({
  logoutSpy: vi.fn(),
  navigateSpy: vi.fn(),
}));

vi.mock('../auth', () => ({
  useAuth: () => ({
    session: {
      token: 'token-1',
      expiresAt: '2026-04-15T00:00:00.000Z',
      user: {
        id: 'user-1',
        displayName: 'Demo User',
        avatarUrl: undefined,
      },
      organization: {
        id: 'org-1',
        name: 'FlowX Org',
      },
    },
    logout: logoutSpy,
  }),
}));

vi.mock('../api', () => ({
  api: {
    getCursorCredentialStatus: vi.fn(),
    getCodexCredentialStatus: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

describe('AppLayout', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
    logoutSpy.mockReset();
    navigateSpy.mockReset();
    vi.mocked(api.getCursorCredentialStatus).mockResolvedValue({
      provider: 'cursor',
      configured: true,
      updatedAt: '2026-04-15T00:00:00.000Z',
    });
    vi.mocked(api.getCodexCredentialStatus).mockResolvedValue({
      provider: 'codex',
      configured: true,
      updatedAt: '2026-04-15T00:00:00.000Z',
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('does not logout when user cancels confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    confirmSpy.mockReturnValue(false);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/workspaces']}>
          <ThemeProvider>
            <AppLayout>
              <div>content</div>
            </AppLayout>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });

    const logoutButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === '退出');
    expect(logoutButton).toBeTruthy();

    await act(async () => {
      logoutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('logs out and navigates when user confirms', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    confirmSpy.mockReturnValue(true);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/workspaces']}>
          <ThemeProvider>
            <AppLayout>
              <div>content</div>
            </AppLayout>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });

    const logoutButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === '退出');
    expect(logoutButton).toBeTruthy();

    await act(async () => {
      logoutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('shows centered modal when both AI credentials are missing', async () => {
    vi.mocked(api.getCursorCredentialStatus).mockResolvedValue({
      provider: 'cursor',
      configured: false,
    });
    vi.mocked(api.getCodexCredentialStatus).mockResolvedValue({
      provider: 'codex',
      configured: false,
    });

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/workspaces']}>
          <ThemeProvider>
            <AppLayout>
              <div>content</div>
            </AppLayout>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(api.getCursorCredentialStatus).toHaveBeenCalledTimes(1);
    expect(api.getCodexCredentialStatus).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('请先配置 AI 凭据');
    expect(document.body.textContent).toContain('未检测到当前账号的 Cursor/Codex 凭据，工作流将无法调用模型。');
    expect(document.body.textContent).toContain('去配置 AI 凭据');
  });

  it('navigates to AI credential settings from the modal action', async () => {
    vi.mocked(api.getCursorCredentialStatus).mockResolvedValue({
      provider: 'cursor',
      configured: false,
    });
    vi.mocked(api.getCodexCredentialStatus).mockResolvedValue({
      provider: 'codex',
      configured: false,
    });

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/workspaces']}>
          <ThemeProvider>
            <AppLayout>
              <div>content</div>
            </AppLayout>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const configureButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '去配置 AI 凭据',
    );
    expect(configureButton).toBeTruthy();

    await act(async () => {
      configureButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(navigateSpy).toHaveBeenCalledWith('/settings/ai-credentials');
  });
});
