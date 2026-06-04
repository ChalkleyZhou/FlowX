import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DingTalkNotificationService } from './dingtalk-notification.service';

describe('DingTalkNotificationService.fetchStaffEmail', () => {
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
          return undefined;
        },
      } as ConfigService,
      {
        authIdentity: { findFirst: authIdentityFindFirst },
      } as never,
    );
  }

  it('returns email from DingTalk user profile when staffId is cached', async () => {
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
        result: {
          org_email: 'alice@company.com',
          email: 'alice@gmail.com',
        },
      }),
    });

    await expect(createService().fetchStaffEmail('user-1', 'corp-1')).resolves.toBe(
      'alice@company.com',
    );
  });

  it('returns null when no DingTalk identity exists', async () => {
    authIdentityFindFirst.mockResolvedValue(null);

    await expect(createService().fetchStaffEmail('user-1', 'corp-1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
