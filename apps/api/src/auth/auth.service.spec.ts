import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService organization resolution', () => {
  function createService(prismaOverrides?: Record<string, unknown>) {
    const prisma = {
      userOrganization: {
        findFirst: vi.fn(),
        upsert: vi.fn(),
      },
      organization: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      ...prismaOverrides,
    };

    return {
      service: new AuthService(
        prisma as never,
        { listProviders: () => [], getProvider: vi.fn() } as never,
        { hashPassword: vi.fn(), verifyPassword: vi.fn() } as never,
      ),
      prisma,
    };
  }

  it('prefers existing user organization membership', async () => {
    const { service, prisma } = createService();
    vi.mocked(prisma.userOrganization.findFirst).mockResolvedValue({
      organization: {
        id: 'org-1',
        name: 'FlowX Org',
        providerOrganizationId: 'corp-1',
      },
    });

    const resolved = await (service as unknown as {
      resolveOrganizationForSession: (
        userId: string,
        requestedOrganizationId: string | null,
      ) => Promise<{ id: string; name: string; providerOrganizationId: string } | null>;
    }).resolveOrganizationForSession('user-1', null);

    expect(resolved).toEqual({
      id: 'org-1',
      name: 'FlowX Org',
      providerOrganizationId: 'corp-1',
    });
  });

  it('auto-joins the only organization for password users', async () => {
    const { service, prisma } = createService();
    vi.mocked(prisma.userOrganization.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.organization.findMany).mockResolvedValue([
      {
        id: 'org-1',
        name: 'FlowX Org',
        providerOrganizationId: 'corp-1',
      },
    ]);
    vi.mocked(prisma.userOrganization.upsert).mockResolvedValue({});

    const resolved = await (service as unknown as {
      resolveOrganizationForSession: (
        userId: string,
        requestedOrganizationId: string | null,
      ) => Promise<{ id: string; name: string; providerOrganizationId: string } | null>;
    }).resolveOrganizationForSession('user-1', null);

    expect(prisma.userOrganization.upsert).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: 'user-1',
          organizationId: 'org-1',
        },
      },
      create: {
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'member',
      },
      update: {},
    });
    expect(resolved).toEqual({
      id: 'org-1',
      name: 'FlowX Org',
      providerOrganizationId: 'corp-1',
    });
  });
});
