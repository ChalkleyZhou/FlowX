// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationUsersPage } from './OrganizationUsersPage';
import { api } from '../api';
import { ThemeProvider } from '../components/theme-provider';
import { ToastProvider } from '../components/ui/toast';

vi.mock('../api', () => ({
  api: {
    getOrganizationMembers: vi.fn(),
    createOrganizationMember: vi.fn(),
    updateOrganizationMember: vi.fn(),
    removeOrganizationMember: vi.fn(),
    transferOrganizationAdmin: vi.fn(),
  },
}));

const sessionWithOrg = {
  token: 'token',
  expiresAt: new Date().toISOString(),
  user: { id: 'user-1', displayName: 'Admin User' },
  organization: { id: 'org-1', name: 'Demo Org' },
};

vi.mock('../auth', () => ({
  useAuth: vi.fn(() => ({
    session: {
      ...sessionWithOrg,
      organization: { ...sessionWithOrg.organization, role: 'admin' },
    },
    logout: vi.fn(),
    refreshSession: vi.fn().mockResolvedValue(null),
  })),
}));

describe('OrganizationUsersPage', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(api.getOrganizationMembers).mockResolvedValue([
      {
        id: 'user-1',
        displayName: 'Admin User',
        account: 'admin',
        role: 'admin',
        status: 'ACTIVE',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'user-2',
        displayName: 'Bob',
        account: 'bob',
        role: 'member',
        status: 'ACTIVE',
        joinedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPage() {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <ThemeProvider>
            <ToastProvider>
              <OrganizationUsersPage />
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('loads and renders organization members', async () => {
    await renderPage();

    expect(api.getOrganizationMembers).toHaveBeenCalled();
    expect(document.body.textContent).toContain('用户管理');
    expect(document.body.textContent).toContain('Demo Org');
    expect(document.body.textContent).toContain('Bob');
    expect(document.body.textContent).toContain('当前用户');
  });
});
