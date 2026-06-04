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
});
