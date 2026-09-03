// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YunxiaoIntegrationPage } from './YunxiaoIntegrationPage';
import { api } from '../api';
import { ThemeProvider } from '../components/theme-provider';
import { ToastProvider } from '../components/ui/toast';
import { ConfirmProvider } from '../components/ConfirmDialog';

vi.mock('../api', () => ({
  api: {
    getYunxiaoIntegration: vi.fn(),
    getYunxiaoUnmatchedRecipients: vi.fn(),
    clearYunxiaoUnmatchedRecipients: vi.fn(),
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
    vi.mocked(api.clearYunxiaoUnmatchedRecipients).mockResolvedValue({ deletedCount: 1 });
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
              <ConfirmProvider>
                <ToastProvider>
                  <YunxiaoIntegrationPage />
                </ToastProvider>
              </ConfirmProvider>
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
        memberId: 'yunxiao-member-1',
        userId: 'yunxiao-user-1',
        aliyunAccountId: 'aliyun-account-1',
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
    expect(container.textContent).toContain('aliyun-account-1');
    expect(container.textContent).toContain('未关联');
  });

  it('管理员可以确认清空未匹配人员记录', async () => {
    vi.mocked(api.getYunxiaoUnmatchedRecipients).mockResolvedValue([{
      id: 'recipient-1',
      eventId: 'event-1',
      workItemId: 'work-item-1',
      projectId: 'project-1',
      yunxiaoUserIdentifier: 'yunxiao-user-1',
      yunxiaoDisplayName: '云效张三',
      roles: ['assignedTo'],
      status: 'UNMATCHED',
      reason: 'No FlowX user is mapped to the Yunxiao member.',
      dingTalkId: null,
      firstSeenAt: '2026-09-03T08:00:00.000Z',
      lastSeenAt: '2026-09-03T08:00:00.000Z',
    }]);
    await renderPage();

    const clearButton = Array.from(container.querySelectorAll('button'))
      .find((item) => item.textContent?.includes('清空记录'));
    expect(clearButton).toBeTruthy();
    await act(async () => {
      clearButton?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('确认清空当前组织全部未匹配人员记录吗？');

    const confirmButton = Array.from(document.body.querySelectorAll('button'))
      .filter((item) => item.textContent === '清空记录')
      .at(-1);
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(api.clearYunxiaoUnmatchedRecipients).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('暂无未匹配人员');
  });
});
