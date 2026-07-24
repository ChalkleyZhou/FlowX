import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService organization resolution', () => {
  function createService(prismaOverrides?: Record<string, unknown>) {
    const prisma = {
      userOrganization: {
        findFirst: vi.fn(),
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
      }).resolveOrganizationForSession('user-1', null, { allowSingletonFallback: true });

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
        options?: { allowSingletonFallback?: boolean },
      ) => Promise<{ id: string; name: string; providerOrganizationId: string } | null>;
    }).resolveOrganizationForSession('user-1', null);

    expect(prisma.userOrganization.upsert).not.toHaveBeenCalled();
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
