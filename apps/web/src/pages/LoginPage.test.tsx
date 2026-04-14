// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth';
import { LoginPage } from './LoginPage';

class LocalStorageMock {
  private readonly store = new Map<string, string>();

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

const { homePageMountSpy, successToastSpy, errorToastSpy } = vi.hoisted(() => ({
  homePageMountSpy: vi.fn(),
  successToastSpy: vi.fn(),
  errorToastSpy: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    loginByPassword: vi.fn(),
    getCurrentSession: vi.fn(),
    setAuthToken: vi.fn(),
    clearAuthToken: vi.fn(),
    selectOrganization: vi.fn(),
  },
  authTokenStorageKey: 'flowx-auth-token',
  toApiUrl: (path: string) => path,
}));

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({
    success: successToastSpy,
    error: errorToastSpy,
  }),
}));

function HomePageProbe() {
  useEffect(() => {
    homePageMountSpy();
  }, []);

  return <div>workspaces-page</div>;
}

function setInputValue(element: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('LoginPage', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('localStorage', new LocalStorageMock());
    window.history.replaceState({}, '', '/login');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    homePageMountSpy.mockReset();
    successToastSpy.mockReset();
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

  it('enters the home page once after password login succeeds', async () => {
    const { api } = await import('../api');
    vi.mocked(api.getCurrentSession).mockRejectedValue(new Error('unauthorized'));
    vi.mocked(api.loginByPassword).mockResolvedValue({
      token: 'token-1',
      expiresAt: '2026-04-15T00:00:00.000Z',
      user: {
        id: 'user-1',
        displayName: 'Demo User',
        avatarUrl: undefined,
      },
      organization: null,
    });

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Navigate to="/workspaces" replace />} />
              <Route path="/workspaces" element={<HomePageProbe />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const accountInput = container.querySelector('#login-account') as HTMLInputElement | null;
    const passwordInput = container.querySelector('#login-password') as HTMLInputElement | null;
    const form = container.querySelector('form');

    expect(accountInput).toBeTruthy();
    expect(passwordInput).toBeTruthy();
    expect(form).toBeTruthy();

    await act(async () => {
      if (accountInput) {
        setInputValue(accountInput, 'demo');
      }
      if (passwordInput) {
        setInputValue(passwordInput, 'password123');
      }
    });

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.loginByPassword).toHaveBeenCalledTimes(1);
    expect(homePageMountSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('workspaces-page');
  });

  it('processes oauth callback only once in strict mode', async () => {
    const { StrictMode } = await import('react');
    const { api } = await import('../api');

    vi.mocked(api.getCurrentSession).mockResolvedValue({
      token: 'token-1',
      expiresAt: '2026-04-15T00:00:00.000Z',
      user: {
        id: 'user-1',
        displayName: 'Demo User',
        avatarUrl: undefined,
      },
      organization: null,
    });

    await act(async () => {
      window.history.replaceState({}, '', '/login?token=oauth-token');
      root?.render(
        <StrictMode>
          <MemoryRouter initialEntries={['/login?token=oauth-token']}>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<Navigate to="/workspaces" replace />} />
                <Route path="/workspaces" element={<HomePageProbe />} />
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </StrictMode>,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.getCurrentSession).toHaveBeenCalledTimes(1);
    expect(successToastSpy).toHaveBeenCalledTimes(1);
    expect(successToastSpy).toHaveBeenCalledWith('登录成功');
  });
});
