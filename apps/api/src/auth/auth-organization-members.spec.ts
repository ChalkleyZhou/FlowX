import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

const joinedAt = new Date('2026-01-01T00:00:00.000Z');

function buildService(prisma: Record<string, unknown>) {
  return new AuthService(
    prisma as never,
    { listProviders: () => [] } as never,
    { hashPassword: (password: string) => `hash:${password}` } as never,
    undefined,
  );
}

describe('AuthService.listOrganizationMembers', () => {
  it('returns members for organization', async () => {
    const prisma = {
      userOrganization: {
        findMany: vi.fn().mockResolvedValue([
          {
            role: 'admin',
            createdAt: joinedAt,
            user: {
              id: 'u1',
              displayName: 'Alice',
              avatarUrl: null,
              account: 'alice',
              email: null,
              status: 'ACTIVE',
              localCredential: { account: 'alice' },
            },
          },
        ]),
      },
    };

    const service = buildService(prisma);
    const result = await service.listOrganizationMembers('org1');

    expect(result).toEqual([
      {
        id: 'u1',
        displayName: 'Alice',
        avatarUrl: null,
        account: 'alice',
        email: null,
        role: 'admin',
        status: 'ACTIVE',
        joinedAt: joinedAt.toISOString(),
      },
    ]);
  });
});

describe('AuthService.resolveInitialMembershipRole', () => {
  it('assigns admin to the first organization member', async () => {
    const prisma = {
      userOrganization: {
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const service = buildService(prisma);
    const role = await (service as unknown as {
      resolveInitialMembershipRole: (organizationId: string) => Promise<'admin' | 'member'>;
    }).resolveInitialMembershipRole('org1');

    expect(role).toBe('admin');
  });

  it('assigns member when organization already has members', async () => {
    const prisma = {
      userOrganization: {
        count: vi.fn().mockResolvedValue(2),
      },
    };
    const service = buildService(prisma);
    const role = await (service as unknown as {
      resolveInitialMembershipRole: (organizationId: string) => Promise<'admin' | 'member'>;
    }).resolveInitialMembershipRole('org1');

    expect(role).toBe('member');
  });
});

describe('AuthService.createOrganizationMember', () => {
  it('creates a new local account and membership for admins', async () => {
    const prisma = {
      userOrganization: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ role: 'admin' })
          .mockResolvedValueOnce({
            role: 'member',
            createdAt: joinedAt,
            user: {
              id: 'u-new',
              displayName: 'Bob',
              avatarUrl: null,
              account: 'bob',
              email: null,
              status: 'ACTIVE',
              localCredential: { account: 'bob' },
            },
          }),
      },
      localCredential: { findUnique: vi.fn().mockResolvedValue(null) },
      user: {
        create: vi.fn().mockResolvedValue({ id: 'u-new' }),
      },
    };

    const service = buildService(prisma);
    const result = await service.createOrganizationMember('org1', 'admin-1', {
      account: 'bob',
      password: 'password123',
      displayName: 'Bob',
    });

    expect(prisma.user.create).toHaveBeenCalled();
    expect(result.id).toBe('u-new');
  });
});

describe('AuthService.transferOrganizationAdmin', () => {
  it('demotes acting admin and promotes target member', async () => {
    const prisma = {
      userOrganization: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'm-admin', role: 'admin' })
          .mockResolvedValueOnce({ id: 'm-target', role: 'member' })
          .mockResolvedValueOnce({
            role: 'admin',
            createdAt: joinedAt,
            user: {
              id: 'u-target',
              displayName: 'Target',
              avatarUrl: null,
              account: 'target',
              email: null,
              status: 'ACTIVE',
              localCredential: { account: 'target' },
            },
          }),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => {
        await Promise.all(ops);
      }),
    };

    const service = buildService(prisma);
    const result = await service.transferOrganizationAdmin('org1', 'admin-1', 'u-target');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.id).toBe('u-target');
    expect(result.role).toBe('admin');
  });
});

describe('AuthService.removeOrganizationMember', () => {
  it('prevents removing yourself', async () => {
    const service = buildService({
      userOrganization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm1', role: 'admin' }),
      },
    });
    await expect(service.removeOrganizationMember('org1', 'u1', 'u1')).rejects.toThrow(
      'You cannot remove yourself from the organization.',
    );
  });
});
