import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService organization resolution', () => {
  function createService(prismaOverrides?: Record<string, unknown>) {
    const prisma = {
      userOrganization: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
        count: vi.fn().mockResolvedValue(1),
      },
      organization: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      oAuthState: {
        create: vi.fn(),
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

  it('does not auto-join an unrelated singleton organization', async () => {
    const { service, prisma } = createService();
    vi.mocked(prisma.userOrganization.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.organization.findMany).mockResolvedValue([
      {
        id: 'org-1',
        name: 'FlowX Org',
        providerOrganizationId: 'corp-1',
      },
    ]);
    const resolved = await (service as unknown as {
      resolveOrganizationForSession: (
        userId: string,
        requestedOrganizationId: string | null,
      ) => Promise<{ id: string; name: string; providerOrganizationId: string } | null>;
      }).resolveOrganizationForSession('user-1', null);

    expect(prisma.userOrganization.upsert).not.toHaveBeenCalled();
    expect(resolved).toBeNull();
  });

  it('does not auto-join the only organization for oauth users without org context', async () => {
    const { service, prisma } = createService();
    vi.mocked(prisma.userOrganization.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.organization.findMany).mockResolvedValue([
      {
        id: 'org-1',
        name: 'FlowX Org',
        providerOrganizationId: 'corp-1',
      },
    ]);

    const resolved = await (service as unknown as {
      resolveOrganizationForSession: (
        userId: string,
        requestedOrganizationId: string | null,
      ) => Promise<{ id: string; name: string; providerOrganizationId: string } | null>;
    }).resolveOrganizationForSession('user-1', null);

    expect(prisma.userOrganization.upsert).not.toHaveBeenCalled();
    expect(resolved).toBeNull();
  });

  it('does not resolve an explicitly requested organization without membership', async () => {
    const { service, prisma } = createService();
    vi.mocked(prisma.userOrganization.findUnique).mockResolvedValue(null);

    const resolved = await (service as unknown as {
      resolveOrganizationForSession: (
        userId: string,
        requestedOrganizationId: string | null,
      ) => Promise<{ id: string; name: string; providerOrganizationId: string } | null>;
    }).resolveOrganizationForSession('user-1', 'org-other');

    expect(prisma.userOrganization.findUnique).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: 'user-1',
          organizationId: 'org-other',
        },
      },
      include: { organization: true },
    });
    expect(resolved).toBeNull();
  });

  it('builds direct API OAuth callback URL without the web proxy /api prefix', async () => {
    const provider = {
      getAuthorizeUrl: vi.fn().mockReturnValue({ url: 'https://login.example.test' }),
    };
    const { service } = createService();
    (service as unknown as { providerRegistry: { getProvider: ReturnType<typeof vi.fn> } }).providerRegistry = {
      listProviders: () => ['dingtalk'],
      getProvider: vi.fn().mockReturnValue(provider),
    } as never;

    await service.createBrowserLoginUrl('dingtalk', {
      backendOrigin: 'http://127.0.0.1:3000',
      callbackUrl: 'cursor://flowx/callback',
    });

    expect(provider.getAuthorizeUrl).toHaveBeenCalledWith({
      state: expect.any(String),
      redirectUri: 'http://127.0.0.1:3000/auth/dingtalk/callback',
    });
  });

  it('keeps the web proxy /api prefix for OAuth callbacks from the Vite dev origin', async () => {
    const provider = {
      getAuthorizeUrl: vi.fn().mockReturnValue({ url: 'https://login.example.test' }),
    };
    const { service } = createService();
    (service as unknown as { providerRegistry: { getProvider: ReturnType<typeof vi.fn> } }).providerRegistry = {
      listProviders: () => ['dingtalk'],
      getProvider: vi.fn().mockReturnValue(provider),
    } as never;

    await service.createBrowserLoginUrl('dingtalk', {
      backendOrigin: 'http://127.0.0.1:5173',
      callbackUrl: 'http://127.0.0.1:5173/login',
    });

    expect(provider.getAuthorizeUrl).toHaveBeenCalledWith({
      state: expect.any(String),
      redirectUri: 'http://127.0.0.1:5173/api/auth/dingtalk/callback',
    });
  });
});

describe('AuthService.resolveBearerAuth', () => {
  function createServiceWithPat(
    personalApiTokenService: { resolveToken: ReturnType<typeof vi.fn> },
    prismaOverrides?: Record<string, unknown>,
  ) {
    const prisma = {
      userOrganization: {
        findFirst: vi.fn(),
        upsert: vi.fn(),
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn().mockResolvedValue({ role: 'admin' }),
      },
      organization: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      oAuthState: {
        create: vi.fn(),
      },
      ...prismaOverrides,
    };

    return {
      service: new AuthService(
        prisma as never,
        { listProviders: () => [], getProvider: vi.fn() } as never,
        { hashPassword: vi.fn(), verifyPassword: vi.fn() } as never,
        undefined,
        personalApiTokenService as never,
      ),
      prisma,
      personalApiTokenService,
    };
  }

  it('resolveBearerAuth accepts personal API tokens', async () => {
    const personalApiTokenService = {
      resolveToken: vi.fn().mockResolvedValue({
        kind: 'personal_api_token',
        tokenId: 'pat-1',
        user: { id: 'u1', email: null, displayName: 'A', avatarUrl: null },
        organization: { id: 'o1', name: 'Org', providerOrganizationId: 'p1' },
      }),
    };
    const { service } = createServiceWithPat(personalApiTokenService);

    const session = await service.resolveBearerAuth('fxpat_abc');

    expect(session.user.id).toBe('u1');
    expect(session.organization?.id).toBe('o1');
    expect(session.organization?.role).toBe('admin');
    expect(session.authKind).toBe('personal_api_token');
    expect(session.expiresAt).toBeNull();
    expect(personalApiTokenService.resolveToken).toHaveBeenCalledWith('fxpat_abc');
  });

  it('resolveBearerAuth rejects a personal API token after organization access is removed', async () => {
    const personalApiTokenService = {
      resolveToken: vi.fn().mockResolvedValue({
        kind: 'personal_api_token',
        tokenId: 'pat-1',
        user: { id: 'u1', email: null, displayName: 'A', avatarUrl: null },
        organization: { id: 'o1', name: 'Org', providerOrganizationId: 'p1' },
      }),
    };
    const { service, prisma } = createServiceWithPat(personalApiTokenService);
    vi.mocked(prisma.userOrganization.findUnique).mockResolvedValue(null);

    await expect(service.resolveBearerAuth('fxpat_abc')).rejects.toThrow(
      'Organization access revoked.',
    );
  });

  it('resolveBearerAuth uses getSession for non-fxpat tokens', async () => {
    const personalApiTokenService = { resolveToken: vi.fn() };
    const { service } = createServiceWithPat(personalApiTokenService);
    const getSessionSpy = vi.spyOn(service, 'getSession').mockResolvedValue({
      token: 'sess-token',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      user: { id: 'u2', email: null, displayName: 'B', avatarUrl: null },
      organization: null,
    });

    const session = await service.resolveBearerAuth('regular-session-token');

    expect(session.authKind).toBe('user_session');
    expect(session.user.id).toBe('u2');
    expect(personalApiTokenService.resolveToken).not.toHaveBeenCalled();
    expect(getSessionSpy).toHaveBeenCalledWith('regular-session-token');
    getSessionSpy.mockRestore();
  });
});

describe('AuthService.getSession organization membership', () => {
  it('rejects an existing session after its organization membership is removed', async () => {
    const prisma = {
      userSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          token: 'session-token',
          userId: 'user-1',
          organizationId: 'org-1',
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          user: {
            id: 'user-1',
            email: null,
            displayName: 'Alice',
            avatarUrl: null,
          },
          organization: {
            id: 'org-1',
            name: 'Org',
            providerOrganizationId: 'provider-org-1',
          },
        }),
      },
      userOrganization: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new AuthService(
      prisma as never,
      { listProviders: () => [] } as never,
      { hashPassword: vi.fn(), verifyPassword: vi.fn() } as never,
    );

    await expect(service.getSession('session-token')).rejects.toThrow(
      'Organization access revoked.',
    );
  });
});
