import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DingTalkNotificationService } from './dingtalk-notification.service';

describe('DingTalkNotificationService.sendPersonalMarkdown', () => {
  const authIdentityFindFirst = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  function createService() {
    return new DingTalkNotificationService(
      {
        get: (key: string) => {
          if (key === 'DINGTALK_APP_ID') {
            return 'app-id';
          }
          if (key === 'DINGTALK_APP_SECRET') {
            return 'app-secret';
          }
          if (key === 'DINGTALK_AGENT_ID') {
            return '123456';
          }
          if (key === 'FLOWX_WEB_BASE_URL') {
            return 'https://flowx.example.com///';
          }
          return undefined;
        },
      } as ConfigService,
      {
        authIdentity: { findFirst: authIdentityFindFirst },
      } as never,
    );
  }

  it('sends markdown work notification to a DingTalk user', async () => {
    authIdentityFindFirst.mockResolvedValue({
      providerUnionId: 'union-1',
      providerRawProfile: { userid: 'staff-1' },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'token-1',
        expires_in: 7200,
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        errcode: 0,
        task_id: 987,
      }),
    });

    await expect(
      createService().sendPersonalMarkdown({
        flowxUserId: 'user-1',
        corpId: 'corp-1',
        title: 'Daily Briefing 2026-06-04',
        markdown: '# Briefing',
      }),
    ).resolves.toEqual({
      errcode: 0,
      task_id: 987,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sendRequest = fetchMock.mock.calls[1];
    expect(String(sendRequest?.[0])).toContain('topapi/message/corpconversation/asyncsend_v2');
    expect(JSON.parse(String(sendRequest?.[1]?.body))).toMatchObject({
      agent_id: 123456,
      userid_list: 'staff-1',
      msg: {
        msgtype: 'markdown',
        markdown: {
          title: 'Daily Briefing 2026-06-04',
          text: '# Briefing',
        },
      },
    });
  });

  it('sends merged owner and status changes with a one-click work item link', async () => {
    authIdentityFindFirst.mockResolvedValue({
      providerRawProfile: { userid: 'staff-2' },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'token-2', expires_in: 7200 }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 0, task_id: 988 }),
    });

    await createService().sendWorkItemChangeMarkdown({
      recipient: {
        flowxUserId: 'user-2',
        displayName: '张三',
        providerOrganizationId: 'corp-1',
      },
      item: {
        id: 'item/1',
        displayCode: 'REQ-001',
        title: '统一登录',
        projectName: 'FlowX',
      },
      actorName: '产品甲',
      ownerChange: { from: null, to: '张三' },
      statusChange: { from: 'ACTIVE', to: 'CLOSED' },
    });

    const sendRequest = fetchMock.mock.calls[1];
    expect(JSON.parse(String(sendRequest?.[1]?.body))).toMatchObject({
      msg: {
        msgtype: 'markdown',
        markdown: {
          title: 'FlowX 工作项发生变更',
          text: expect.stringContaining('[查看工作项](https://flowx.example.com/work-items/item%2F1)'),
        },
      },
    });
    const markdown = JSON.parse(String(sendRequest?.[1]?.body)).msg.markdown.text as string;
    expect(markdown).toContain('REQ-001 统一登录');
    expect(markdown).toContain('项目：FlowX');
    expect(markdown).toContain('变更人：产品甲');
    expect(markdown).toContain('负责人：未指定 → 张三');
    expect(markdown).toContain('状态：进行中 → 已关闭');
  });

  it('preserves unknown statuses and omits an unusable link when no public URL is configured', async () => {
    authIdentityFindFirst.mockResolvedValue({ providerRawProfile: { userid: 'staff-3' } });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'token-3', expires_in: 7200 }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 0 }),
    });

    const service = new DingTalkNotificationService(
      {
        get: (key: string) => (key === 'DINGTALK_APP_ID' ? 'app-id' : key === 'DINGTALK_APP_SECRET' ? 'app-secret' : key === 'DINGTALK_AGENT_ID' ? '123456' : undefined),
      } as ConfigService,
      { authIdentity: { findFirst: authIdentityFindFirst } } as never,
    );
    await service.sendWorkItemChangeMarkdown({
      recipient: { flowxUserId: 'user-3', displayName: '李四', providerOrganizationId: 'corp-1' },
      item: { id: 'item-3', displayCode: 'BUG-001', title: '异常', projectName: 'FlowX' },
      actorName: '测试甲',
      statusChange: { from: 'CUSTOM_STATUS', to: 'CLOSED' },
    });

    const markdown = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).msg.markdown.text as string;
    expect(markdown).toContain('状态：CUSTOM_STATUS → 已关闭');
    expect(markdown).not.toContain('localhost');
    expect(markdown).not.toContain('[查看工作项]');
  });
});
