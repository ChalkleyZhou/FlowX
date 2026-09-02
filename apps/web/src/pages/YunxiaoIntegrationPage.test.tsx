// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YunxiaoIntegrationPage } from './YunxiaoIntegrationPage';
import { api } from '../api';
import { ThemeProvider } from '../components/theme-provider';
import { ToastProvider } from '../components/ui/toast';

vi.mock('../api', () => ({
  api: {
    getYunxiaoIntegration: vi.fn(),
    getYunxiaoUnmatchedRecipients: vi.fn(),
    getYunxiaoProjectMembers: vi.fn(),
    updateYunxiaoMemberMapping: vi.fn(),
    updateYunxiaoIntegration: vi.fn(),
  },
}));

vi.mock('../auth', () => ({
  useAuth: vi.fn(() => ({
    session: {
      token: 'token',
      expiresAt: null,
      user: { id: 'admin-1', displayName: '管理员' },
      organization: { id: 'org-1', name: '测试组织', role: 'admin', provider: 'dingtalk' },
    },
  })),
}));

describe('YunxiaoIntegrationPage', () => {
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
    vi.mocked(api.getYunxiaoIntegration).mockResolvedValue({
      provider: 'YUNXIAO',
      enabled: true,
      configured: true,
      openApiConfigured: true,
      webhookPath: '/api/yunxiao-webhooks',
      yunxiaoOrganizationIdentifier: 'yunxiao-org-1',
    });
    vi.mocked(api.getYunxiaoUnmatchedRecipients).mockResolvedValue([]);
    vi.mocked(api.updateYunxiaoMemberMapping).mockResolvedValue({});
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPage() {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <ThemeProvider>
            <ToastProvider>
              <YunxiaoIntegrationPage />
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

  it('加载云效项目成员并展示 FlowX 关联入口', async () => {
    vi.mocked(api.getYunxiaoProjectMembers).mockResolvedValue({
      projectId: 'project-1',
      yunxiaoOrganizationIdentifier: 'yunxiao-org-1',
      members: [{
        userId: 'yunxiao-user-1',
        dingTalkId: null,
        displayName: '云效张三',
        displayRealName: null,
        stamp: null,
        roleName: '项目成员',
        roleId: 'member',
        flowxUserId: null,
      }],
      flowxUsers: [{
        id: 'flowx-user-1',
        displayName: '张三',
        account: 'zhangsan',
        email: null,
      }],
    });
    await renderPage();

    const projectInput = container.querySelector('input[placeholder*="云效项目 ID"]') as HTMLInputElement;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(projectInput, 'project-1');
      projectInput.dispatchEvent(new Event('input', { bubbles: true }));
      const button = Array.from(container.querySelectorAll('button'))
        .find((item) => item.textContent?.includes('加载成员'));
      button?.click();
      await Promise.resolve();
    });

    expect(api.getYunxiaoProjectMembers).toHaveBeenCalledWith('project-1');
    expect(container.textContent).toContain('云效张三');
    expect(container.textContent).toContain('yunxiao-user-1');
    expect(container.textContent).toContain('未关联');
  });
});
