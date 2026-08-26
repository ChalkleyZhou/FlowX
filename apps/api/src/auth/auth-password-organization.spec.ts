import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService.registerByPassword organization isolation', () => {
  it('creates an independent organization for a standalone registration', async () => {
    const prisma = {
      localCredential: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user-alice',
          displayName: 'Alice',
        }),
      },
      organization: {
        create: vi.fn().mockResolvedValue({
          id: 'org-alice',
          name: 'Alice 的组织',
          providerOrganizationId: 'local:user-alice',
        }),
      },
      userOrganization: {
        create: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    const passwordService = {
      hashPassword: vi.fn().mockReturnValue('hashed-password'),
    };
    const service = new AuthService(
      prisma as never,
      { listProviders: () => [] } as never,
      passwordService as never,
    );
    const createSession = vi.fn().mockResolvedValue({ token: 'token-alice' });
    (service as unknown as { createSession: typeof createSession }).createSession = createSession;

    await expect(
      service.registerByPassword({
        account: ' Alice ',
        password: 'password123',
        displayName: ' Alice ',
      }),
    ).resolves.toEqual({ token: 'token-alice' });

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: {
        provider: 'local',
        providerOrganizationId: 'local:user-alice',
        name: 'Alice 的组织',
      },
    });
    expect(prisma.userOrganization.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-alice',
        organizationId: 'org-alice',
        role: 'admin',
      },
    });
    expect(createSession).toHaveBeenCalledWith('user-alice', 'org-alice');
  });
});
