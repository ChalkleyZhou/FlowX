import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YunxiaoMembersService } from './yunxiao-members.service';

describe('YunxiaoMembersService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createService(values: Record<string, string | undefined>) {
    return new YunxiaoMembersService({
      get: (key: string) => values[key],
    } as ConfigService);
  }

  it('使用个人 Token 通过标准 OpenAPI 查询项目成员', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        members: [
          {
            userId: 'yunxiao-user-1',
            identifier: 'legacy-member-identifier',
            userName: '张三',
            roleName: '项目成员',
            roleId: 'member',
          },
          {
            identifier: 'group-1',
            displayName: '项目组',
            stamp: 'UserGroup',
          },
        ],
      }),
    });
    const service = createService({
      YUNXIAO_PERSONAL_ACCESS_TOKEN: 'personal-token',
      YUNXIAO_REGION_ID: 'cn-hangzhou',
    });

    await expect(service.listProjectMembers('org-1', 'project-1')).resolves.toEqual([
      {
        userId: 'yunxiao-user-1',
        dingTalkId: null,
        displayName: '张三',
        displayRealName: null,
        stamp: null,
        roleName: '项目成员',
        roleId: 'member',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      'https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org-1/projects/project-1/members',
    );
    expect(options).toEqual({
      headers: {
        accept: 'application/json',
        authorization: 'Bearer personal-token',
        'x-yunxiao-token': 'personal-token',
      },
    });
  });

  it('个人 Token 和 AccessKey 同时配置时优先使用个人 Token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, members: [] }),
    });
    const service = createService({
      YUNXIAO_PERSONAL_ACCESS_TOKEN: 'personal-token',
      YUNXIAO_ACCESS_KEY_ID: 'access-key-id',
      YUNXIAO_ACCESS_KEY_SECRET: 'access-key-secret',
    });

    expect(service.isConfigured()).toBe(true);
    await service.listProjectMembers('org-1', 'project-1');

    const [, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(options.headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer personal-token',
      'x-yunxiao-token': 'personal-token',
    });
  });

  it('个人 Token 请求失败时返回不泄露 Token 的通用错误', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ success: false, errorMsg: 'NoPermission' }),
    });
    const service = createService({
      YUNXIAO_PERSONAL_ACCESS_TOKEN: 'personal-token',
    });

    await expect(service.listProjectMembers('org-1', 'project-1')).rejects.toThrow(
      'Yunxiao project member API request failed (403).',
    );
  });
});
