import { describe, expect, it, vi } from 'vitest';
import { DingTalkAuthProvider } from './dingtalk.provider';

describe('DingTalkAuthProvider', () => {
  it('does not fabricate a default organization when dingtalk returns none', async () => {
    const provider = new DingTalkAuthProvider({
      get: vi.fn((key: string) => {
        switch (key) {
          case 'DINGTALK_APP_ID':
            return 'app-id';
          case 'DINGTALK_APP_SECRET':
            return 'app-secret';
          case 'DINGTALK_TOKEN_URL':
            return 'https://example.com/token';
          case 'DINGTALK_PROFILE_URL':
            return 'https://example.com/profile';
          case 'DINGTALK_ORGS_URL':
            return 'https://example.com/orgs';
          default:
            return undefined;
        }
      }),
    } as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'access-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unionId: 'union-1', nick: 'Ding User' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organizations: [] }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.exchangeCode({
      code: 'oauth-code',
      redirectUri: 'https://app.example.com/api/auth/dingtalk/callback',
    });

    expect(result.organizations).toEqual([]);
    expect(result.profile).toMatchObject({
      userId: 'union-1',
      displayName: 'Ding User',
    });

    vi.unstubAllGlobals();
  });

  it('prefers the organization returned by the token response corpId', async () => {
    const provider = new DingTalkAuthProvider({
      get: vi.fn((key: string) => {
        switch (key) {
          case 'DINGTALK_APP_ID':
            return 'app-id';
          case 'DINGTALK_APP_SECRET':
            return 'app-secret';
          case 'DINGTALK_TOKEN_URL':
            return 'https://example.com/token';
          case 'DINGTALK_PROFILE_URL':
            return 'https://example.com/profile';
          case 'DINGTALK_ORGS_URL':
            return 'https://example.com/orgs';
          default:
            return undefined;
        }
      }),
    } as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'access-token', corpId: 'corp-selected' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unionId: 'union-1', nick: 'Ding User' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organizations: [
            { corpId: 'corp-default', name: '默认组织' },
            { corpId: 'corp-selected', name: '已选组织' },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.exchangeCode({
      code: 'oauth-code',
      redirectUri: 'https://app.example.com/api/auth/dingtalk/callback',
    });

    expect(result.organizations).toEqual([
      {
        id: 'corp-selected',
        name: '已选组织',
        logoUrl: undefined,
      },
    ]);

    vi.unstubAllGlobals();
  });

  it('loads organization name from owned organizations when corpId is selected but org list is empty', async () => {
    const provider = new DingTalkAuthProvider({
      get: vi.fn((key: string) => {
        switch (key) {
          case 'DINGTALK_APP_ID':
            return 'app-id';
          case 'DINGTALK_APP_SECRET':
            return 'app-secret';
          case 'DINGTALK_TOKEN_URL':
            return 'https://example.com/token';
          case 'DINGTALK_PROFILE_URL':
            return 'https://example.com/profile';
          case 'DINGTALK_ORGS_URL':
            return 'https://example.com/orgs';
          case 'DINGTALK_OWNED_ORGS_URL':
            return 'https://example.com/owned-organizations';
          default:
            return undefined;
        }
      }),
    } as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'access-token', corpId: 'corp-selected' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unionId: 'union-1', userid: 'user-1', nick: 'Ding User' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organizations: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'app-access-token' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          orgList: [
            { corpId: 'corp-selected', corpName: '真实钉钉组织' },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.exchangeCode({
      code: 'oauth-code',
      redirectUri: 'https://app.example.com/api/auth/dingtalk/callback',
    });

    expect(result.organizations).toEqual([
      {
        id: 'corp-selected',
        name: '真实钉钉组织',
      },
    ]);

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://example.com/owned-organizations?userId=user-1',
      {
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': 'access-token',
        },
      },
    );

    vi.unstubAllGlobals();
  });

  it('resolves userid by unionId before loading owned organizations', async () => {
    const provider = new DingTalkAuthProvider({
      get: vi.fn((key: string) => {
        switch (key) {
          case 'DINGTALK_APP_ID':
            return 'app-id';
          case 'DINGTALK_APP_SECRET':
            return 'app-secret';
          case 'DINGTALK_TOKEN_URL':
            return 'https://example.com/token';
          case 'DINGTALK_PROFILE_URL':
            return 'https://example.com/profile';
          case 'DINGTALK_ORGS_URL':
            return 'https://example.com/orgs';
          case 'DINGTALK_OWNED_ORGS_URL':
            return 'https://example.com/owned-organizations';
          case 'DINGTALK_APP_ACCESS_TOKEN_URL':
            return 'https://example.com/oauth2/{corpId}/token';
          case 'DINGTALK_GET_USER_BY_UNION_ID_URL':
            return 'https://example.com/get-user-by-unionid';
          default:
            return undefined;
        }
      }),
    } as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'user-access-token', corpId: 'corp-selected' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unionId: 'union-1', nick: 'Ding User' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organizations: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'app-access-token' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'corp-app-access-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errcode: 0,
          result: {
            userid: 'user-from-unionid',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ orgList: [{ corpId: 'corp-selected', corpName: '真实钉钉组织' }] }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.exchangeCode({
      code: 'oauth-code',
      redirectUri: 'https://app.example.com/api/auth/dingtalk/callback',
    });

    expect(result.organizations).toEqual([
      {
        id: 'corp-selected',
        name: '真实钉钉组织',
      },
    ]);

    vi.unstubAllGlobals();
  });

  it('loads organization name from auth info API when corpId is selected', async () => {
    const provider = new DingTalkAuthProvider({
      get: vi.fn((key: string) => {
        switch (key) {
          case 'DINGTALK_APP_ID':
            return 'app-id';
          case 'DINGTALK_APP_SECRET':
            return 'app-secret';
          case 'DINGTALK_TOKEN_URL':
            return 'https://example.com/token';
          case 'DINGTALK_PROFILE_URL':
            return 'https://example.com/profile';
          case 'DINGTALK_ORGS_URL':
            return 'https://example.com/orgs';
          default:
            return undefined;
        }
      }),
    } as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'access-token', corpId: 'corp-selected' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unionId: 'union-1', nick: 'Ding User' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organizations: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'app-access-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ orgName: '通过认证接口获取的组织' }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.exchangeCode({
      code: 'oauth-code',
      redirectUri: 'https://app.example.com/api/auth/dingtalk/callback',
    });

    expect(result.organizations).toEqual([
      {
        id: 'corp-selected',
        name: '通过认证接口获取的组织',
      },
    ]);

    vi.unstubAllGlobals();
  });
});
