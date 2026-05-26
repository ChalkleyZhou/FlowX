import { describe, expect, it, vi } from 'vitest';
import {
  applyOrganizationAdminBackfill,
  planOrganizationAdminBackfill,
} from '../../../../scripts/backfill-organization-admins.js';

describe('organization admin backfill', () => {
  it('plans earliest member when organization has no admin', async () => {
    const joinedEarly = new Date('2026-01-01T00:00:00.000Z');
    const joinedLate = new Date('2026-01-02T00:00:00.000Z');
    const prisma = {
      organization: {
        findMany: vi.fn().mockResolvedValue([{ id: 'org-1', name: 'Demo Org' }]),
      },
      userOrganization: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue({
          createdAt: joinedEarly,
          user: { id: 'user-1', displayName: 'Alice' },
        }),
        update: vi.fn(),
      },
    };

    const result = await planOrganizationAdminBackfill(prisma as never);

    expect(result.planned).toEqual([
      {
        organizationId: 'org-1',
        organizationName: 'Demo Org',
        userId: 'user-1',
        displayName: 'Alice',
        joinedAt: joinedEarly,
      },
    ]);
    expect(result.skippedWithAdmin).toEqual([]);
    expect(joinedLate).toBeTruthy();
  });

  it('skips organizations that already have an admin', async () => {
    const prisma = {
      organization: {
        findMany: vi.fn().mockResolvedValue([{ id: 'org-1', name: 'Demo Org' }]),
      },
      userOrganization: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };

    const result = await planOrganizationAdminBackfill(prisma as never);

    expect(result.planned).toEqual([]);
    expect(result.skippedWithAdmin).toEqual(['Demo Org']);
    expect(prisma.userOrganization.findFirst).not.toHaveBeenCalled();
  });

  it('applies admin role updates', async () => {
    const prisma = {
      userOrganization: {
        update: vi.fn().mockResolvedValue({}),
      },
    };

    await applyOrganizationAdminBackfill(prisma as never, [
      {
        organizationId: 'org-1',
        organizationName: 'Demo Org',
        userId: 'user-1',
        displayName: 'Alice',
        joinedAt: new Date(),
      },
    ]);

    expect(prisma.userOrganization.update).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: 'user-1',
          organizationId: 'org-1',
        },
      },
      data: { role: 'admin' },
    });
  });
});
