import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService.listOrganizationMembers', () => {
  it('returns members for organization', async () => {
    const prisma = {
      userOrganization: {
        findMany: vi.fn().mockResolvedValue([
          { user: { id: 'u1', displayName: 'Alice', avatarUrl: null } },
        ]),
      },
    };

    const service = new AuthService(prisma as never, { listProviders: () => [] } as never, {} as never);
    const result = await service.listOrganizationMembers('org1');

    expect(result).toEqual([{ id: 'u1', displayName: 'Alice', avatarUrl: null }]);
    expect(prisma.userOrganization.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
  });
});
