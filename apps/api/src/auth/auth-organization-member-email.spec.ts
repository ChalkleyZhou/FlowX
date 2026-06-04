import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

function buildService(
  prisma: Record<string, unknown>,
  dingTalkNotification?: { fetchStaffEmail: ReturnType<typeof vi.fn> },
) {
  return new AuthService(
    prisma as never,
    { listProviders: () => [] } as never,
    { hashPassword: (password: string) => `hash:${password}` } as never,
    dingTalkNotification as never,
  );
}

describe('AuthService.resolveOrganizationMemberEmail', () => {
  it('returns cached profile email without calling DingTalk', async () => {
    const prisma = {
      userOrganization: {
        findUnique: vi.fn().mockResolvedValue({
          user: { id: 'u1', email: 'alice@example.com' },
        }),
      },
    };

    const dingTalk = { fetchStaffEmail: vi.fn() };
    const service = buildService(prisma, dingTalk);

    await expect(service.resolveOrganizationMemberEmail('org-1', 'u1')).resolves.toEqual({
      email: 'alice@example.com',
      source: 'profile',
    });
    expect(dingTalk.fetchStaffEmail).not.toHaveBeenCalled();
  });

  it('falls back to DingTalk and caches the resolved email', async () => {
    const userUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      userOrganization: {
        findUnique: vi.fn().mockResolvedValue({
          user: { id: 'u1', email: null },
        }),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          provider: 'dingtalk',
          providerOrganizationId: 'corp-1',
        }),
      },
      user: { update: userUpdate },
    };
    const dingTalk = {
      fetchStaffEmail: vi.fn().mockResolvedValue('bob@company.com'),
    };

    const service = buildService(prisma, dingTalk);

    await expect(service.resolveOrganizationMemberEmail('org-1', 'u1')).resolves.toEqual({
      email: 'bob@company.com',
      source: 'dingtalk',
    });
    expect(dingTalk.fetchStaffEmail).toHaveBeenCalledWith('u1', 'corp-1');
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { email: 'bob@company.com' },
    });
  });

  it('throws when the member is not in the organization', async () => {
    const prisma = {
      userOrganization: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      buildService(prisma).resolveOrganizationMemberEmail('org-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when no email can be resolved', async () => {
    const prisma = {
      userOrganization: {
        findUnique: vi.fn().mockResolvedValue({
          user: { id: 'u1', email: null },
        }),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          provider: 'dingtalk',
          providerOrganizationId: 'corp-1',
        }),
      },
    };
    const dingTalk = {
      fetchStaffEmail: vi.fn().mockResolvedValue(null),
    };

    await expect(
      buildService(prisma, dingTalk).resolveOrganizationMemberEmail('org-1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
