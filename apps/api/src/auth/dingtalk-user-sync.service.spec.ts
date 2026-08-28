import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingTalkUserSyncService } from './dingtalk-user-sync.service';

function buildService(prisma: Record<string, unknown>, config: Record<string, string> = {}) {
  return new DingTalkUserSyncService(
    {
      get: (key: string) => config[key],
    } as never,
    prisma as never,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DingTalkUserSyncService', () => {
  it('recursively reads departments, de-duplicates users, and persists no departments', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', expires_in: 7200 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errcode: 0,
        result: {
          list: [{ userid: 'staff-1', unionid: 'union-1', name: 'Alice' }],
          has_more: true,
          next_cursor: 100,
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errcode: 0,
        result: {
          list: [{ userid: 'staff-2', unionid: 'union-2', name: 'Bob', email: 'bob@example.com' }],
          has_more: false,
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, result: { dept_id_list: [2] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errcode: 0,
        result: {
          list: [{ userid: 'staff-1', unionid: 'union-1', name: 'Alice' }],
          has_more: false,
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, result: { dept_id_list: [] } })));
    vi.stubGlobal('fetch', fetchMock);

    const prisma = {
      authIdentity: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn()
          .mockResolvedValueOnce({ userId: 'user-1' })
          .mockResolvedValueOnce({ userId: 'user-2' }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'user-1' })
          .mockResolvedValueOnce({ id: 'user-2' }),
      },
      userOrganization: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const service = buildService(prisma, {
      DINGTALK_APP_ID: 'app-id',
      DINGTALK_APP_SECRET: 'app-secret',
    });

    await expect(service.syncOrganizationUsers('org-1', 'corp-1')).resolves.toEqual({
      total: 2,
      created: 2,
      updated: 0,
      addedToOrganization: 2,
    });
    expect(prisma.user.create).toHaveBeenCalledTimes(2);
    expect(prisma.userOrganization.upsert).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('updates an existing DingTalk identity and preserves its existing membership', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', expires_in: 7200 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errcode: 0,
        result: { list: [{ userid: 'staff-1', unionid: 'union-1', name: 'Alice Updated' }], has_more: false },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, result: { dept_id_list: [] } }))));

    const prisma = {
      authIdentity: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'identity-1', userId: 'user-1', providerUserId: 'union-1', providerUnionId: 'union-1' },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      user: { update: vi.fn().mockResolvedValue({}) },
      userOrganization: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }]),
      },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const service = buildService(prisma, {
      DINGTALK_APP_ID: 'app-id',
      DINGTALK_APP_SECRET: 'app-secret',
    });

    await expect(service.syncOrganizationUsers('org-1', 'corp-1')).resolves.toEqual({
      total: 1,
      created: 0,
      updated: 1,
      addedToOrganization: 0,
    });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: expect.objectContaining({ displayName: 'Alice Updated' }),
    }));
    expect(prisma.userOrganization).not.toHaveProperty('upsert');
  });

  it('rejects synchronization when DingTalk credentials are missing', async () => {
    const service = buildService({});

    await expect(service.syncOrganizationUsers('org-1', 'corp-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns a sanitized upstream error when DingTalk rejects a request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 'InvalidParameter', message: 'bad credentials' }),
      { status: 401 },
    )));
    const service = buildService({}, {
      DINGTALK_APP_ID: 'app-id',
      DINGTALK_APP_SECRET: 'app-secret',
    });

    await expect(service.syncOrganizationUsers('org-1', 'corp-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('reports the exact missing DingTalk directory permission without exposing app details', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'token', expireIn: 7200 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errcode: 88,
        errmsg: 'ding talk error[subcode=60011,submsg=missing permission qyapi_get_department_member, app=dingo-secret]',
      }))));
    const service = buildService({}, {
      DINGTALK_APP_ID: 'app-id',
      DINGTALK_APP_SECRET: 'app-secret',
    });

    const error = await service.syncOrganizationUsers('org-1', 'corp-1').catch((caught) => caught);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).toBe(
      'DingTalk app is missing required permission: qyapi_get_department_member.',
    );
    expect(error.message).not.toContain('dingo-secret');
  });
});
