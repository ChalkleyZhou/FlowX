// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';
import { ThemeProvider } from './theme-provider';

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
});
