import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { ProviderRegistryService } from './providers/provider-registry.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly passwordService: PasswordService,
  ) {}

  listProviders() {
    return this.providerRegistry.listProviders().map((name) => ({ name }));
  }

  async createBrowserLoginUrl(
    providerName: string,
    input: {
      callbackUrl: string;
      next?: string;
      backendOrigin: string;
    },
  ) {
    const statePayload = this.encodeBrowserState({
      callbackUrl: input.callbackUrl,
      next: input.next,
    });
    const redirectUri = this.buildProviderCallbackUrl(providerName, {
      backendOrigin: input.backendOrigin,
    });
    const result = await this.createAuthorizeUrl(providerName, redirectUri, statePayload);
    return result.url;
  }

  async handleBrowserCallback(
    providerName: string,
    input: {
      code?: string;
      state?: string;
      callbackUrl?: string;
      next?: string;
      error?: string;
      errorDescription?: string;
      backendOrigin: string;
    },
  ) {
    const browserState = this.decodeBrowserState(input.state);
    const resolvedCallbackUrl = browserState?.callbackUrl ?? input.callbackUrl;
    if (!resolvedCallbackUrl) {
      throw new BadRequestException('callbackUrl is required.');
    }
    const callbackUrl = new URL(resolvedCallbackUrl);
    const nextPath = browserState?.next ?? input.next;
    if (nextPath) {
      callbackUrl.searchParams.set('next', nextPath);
    }

    if (input.error || input.errorDescription) {
      callbackUrl.searchParams.set('error', input.error ?? 'dingtalk_login_failed');
      callbackUrl.searchParams.set(
        'error_description',
        input.errorDescription ?? '钉钉登录失败',
      );
      return callbackUrl.toString();
    }

    if (!input.code || !input.state) {
      callbackUrl.searchParams.set('error', 'missing_code');
      callbackUrl.searchParams.set('error_description', '缺少钉钉回调参数');
      return callbackUrl.toString();
    }

    const redirectUri = this.buildProviderCallbackUrl(providerName, {
      backendOrigin: input.backendOrigin,
    });

    try {
      const result = await this.exchangeCode(providerName, {
        code: input.code,
        state: input.state,
        redirectUri,
      });

      if ('selectionToken' in result) {
        callbackUrl.searchParams.set('selectionToken', result.selectionToken);
        callbackUrl.searchParams.set(
          'organizations',
          encodeURIComponent(JSON.stringify(result.organizations)),
        );
        return callbackUrl.toString();
      }

      callbackUrl.searchParams.set('token', result.token);
      return callbackUrl.toString();
    } catch (error) {
      callbackUrl.searchParams.set('error', 'dingtalk_login_failed');
      callbackUrl.searchParams.set(
        'error_description',
        error instanceof Error ? error.message : '钉钉登录失败',
      );
      return callbackUrl.toString();
    }
  }

  async createAuthorizeUrl(
    providerName: string,
    redirectUri: string,
    browserStatePayload?: string,
  ) {
    const provider = this.providerRegistry.getProvider(providerName);
    const stateSeed = this.createToken(24);
    const state = browserStatePayload ? `${stateSeed}.${browserStatePayload}` : stateSeed;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.prisma.oAuthState.create({
      data: {
        provider: providerName,
        state,
        redirectUri,
        expiresAt,
      },
    });
    try {
      return {
        provider: providerName,
        state,
        ...provider.getAuthorizeUrl({ state, redirectUri }),
        expiresAt,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to build authorize url.',
      );
    }
  }

  private buildProviderCallbackUrl(
    providerName: string,
    input: {
      backendOrigin: string;
    },
  ) {
    return new URL(`/api/auth/${providerName}/callback`, input.backendOrigin).toString();
  }

  private encodeBrowserState(input: { callbackUrl: string; next?: string }) {
    return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
  }

  private decodeBrowserState(state?: string) {
    if (!state || !state.includes('.')) {
      return null;
    }
    const payload = state.split('.').slice(1).join('.');
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        callbackUrl: string;
        next?: string;
      };
    } catch {
      return null;
    }
  }

  async exchangeCode(
    providerName: string,
    input: { code: string; state: string; redirectUri: string },
  ) {
    const provider = this.providerRegistry.getProvider(providerName);
    const stateRecord = await this.prisma.oAuthState.findUnique({
      where: { state: input.state },
    });
    if (
      !stateRecord ||
      stateRecord.provider !== providerName ||
      stateRecord.usedAt ||
      stateRecord.expiresAt.getTime() < Date.now() ||
      stateRecord.redirectUri !== input.redirectUri
    ) {
      throw new UnauthorizedException('Invalid or expired OAuth state.');
    }

    let result;
    try {
      result = await provider.exchangeCode({
        code: input.code,
        redirectUri: input.redirectUri,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to exchange oauth code.',
      );
    }

    await this.prisma.oAuthState.update({
      where: { id: stateRecord.id },
      data: { usedAt: new Date() },
    });

    if (result.organizations.length <= 1) {
      const selectedOrganization = result.organizations[0] ?? null;
      return this.finalizeLogin(
        providerName,
        result.profile,
        selectedOrganization
          ? {
              providerOrganizationId: selectedOrganization.id,
              name: selectedOrganization.name,
              logoUrl: selectedOrganization.logoUrl,
            }
          : null,
      );
    }

    const selectionToken = this.createToken(24);
    await this.prisma.pendingOrganizationSelection.create({
      data: {
        token: selectionToken,
        provider: providerName,
        profile: result.profile as unknown as Prisma.InputJsonValue,
        organizations: result.organizations as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    return {
      needOrganizationSelection: true,
      selectionToken,
      organizations: result.organizations,
    };
  }

  async selectOrganization(input: {
    selectionToken: string;
    organizationId: string;
  }) {
    const selection = await this.prisma.pendingOrganizationSelection.findUnique({
      where: { token: input.selectionToken },
    });
    if (
      !selection ||
      selection.consumedAt ||
      selection.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired organization selection token.');
    }

    const organizations = selection.organizations as Array<{
      id: string;
      name: string;
      logoUrl?: string;
    }>;
    const selected = organizations.find((item) => item.id === input.organizationId);
    if (!selected) {
      throw new BadRequestException('Selected organization is not available.');
    }

    await this.prisma.pendingOrganizationSelection.update({
      where: { id: selection.id },
      data: { consumedAt: new Date() },
    });

    return this.finalizeLogin(
      selection.provider,
      selection.profile as {
        userId: string;
        unionId?: string;
        displayName: string;
        email?: string;
        avatarUrl?: string;
        raw?: unknown;
      },
      {
        providerOrganizationId: selected.id,
        name: selected.name,
        logoUrl: selected.logoUrl,
      },
    );
  }

  async getSession(sessionToken: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { token: sessionToken },
      include: {
        user: true,
        organization: true,
      },
    });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired.');
    }

    const resolvedOrganization = session.organization
      ? {
          id: session.organization.id,
          name: session.organization.name,
          providerOrganizationId: session.organization.providerOrganizationId,
        }
      : await this.resolveOrganizationForSession(session.userId, null);

    if (!session.organizationId && resolvedOrganization) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: {
          organizationId: resolvedOrganization.id,
        },
      });
    }

    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      },
      organization: resolvedOrganization,
    };
  }

  async registerByPassword(input: {
    account: string;
    password: string;
    displayName?: string;
  }) {
    const account = input.account.trim().toLowerCase();
    const existing = await this.prisma.localCredential.findUnique({
      where: { account },
    });
    if (existing) {
      throw new ConflictException('Account already exists.');
    }

    const passwordHash = this.passwordService.hashPassword(input.password);
    const user = await this.prisma.user.create({
      data: {
        account,
        displayName: input.displayName?.trim() || account,
        localCredential: {
          create: {
            account,
            passwordHash,
          },
        },
      },
    });

    return this.createSession(user.id, null);
  }

  async loginByPassword(input: { account: string; password: string }) {
    const account = input.account.trim().toLowerCase();
    const credential = await this.prisma.localCredential.findUnique({
      where: { account },
      include: { user: true },
    });
    if (!credential) {
      throw new NotFoundException('Account not found.');
    }

    const valid = this.passwordService.verifyPassword(
      input.password,
      credential.passwordHash,
    );
    if (!valid) {
      throw new UnauthorizedException('Invalid password.');
    }

    return this.createSession(credential.userId, null);
  }

  private async finalizeLogin(
    provider: string,
    profile: {
      userId: string;
      unionId?: string;
      displayName: string;
      email?: string;
      avatarUrl?: string;
      raw?: unknown;
    },
    organization: {
      providerOrganizationId: string;
      name: string;
      logoUrl?: string;
    } | null,
  ) {
    const identity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId: profile.userId,
        },
      },
      include: { user: true },
    });

    const user = identity
      ? await this.prisma.user.update({
          where: { id: identity.userId },
          data: {
            displayName: profile.displayName,
            email: profile.email,
            avatarUrl: profile.avatarUrl,
          },
        })
      : await this.prisma.user.create({
          data: {
            displayName: profile.displayName,
            email: profile.email,
            avatarUrl: profile.avatarUrl,
            identities: {
              create: {
                provider,
                providerUserId: profile.userId,
                providerUnionId: profile.unionId,
                providerRawProfile: (profile.raw ?? profile) as Prisma.InputJsonValue,
                lastLoginAt: new Date(),
              },
            },
          },
        });

    if (identity) {
      await this.prisma.authIdentity.update({
        where: { id: identity.id },
        data: {
          providerUnionId: profile.unionId,
          providerRawProfile: (profile.raw ?? profile) as Prisma.InputJsonValue,
          lastLoginAt: new Date(),
        },
      });
    }

    let organizationRecord: { id: string; name: string; providerOrganizationId: string } | null =
      null;
    if (organization) {
      const upsertedOrg = await this.prisma.organization.upsert({
        where: {
          provider_providerOrganizationId: {
            provider,
            providerOrganizationId: organization.providerOrganizationId,
          },
        },
        create: {
          provider,
          providerOrganizationId: organization.providerOrganizationId,
          name: organization.name,
          logoUrl: organization.logoUrl,
        },
        update: {
          name: organization.name,
          logoUrl: organization.logoUrl,
        },
      });
      organizationRecord = {
        id: upsertedOrg.id,
        name: upsertedOrg.name,
        providerOrganizationId: upsertedOrg.providerOrganizationId,
      };

      await this.prisma.userOrganization.upsert({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: upsertedOrg.id,
          },
        },
        create: {
          userId: user.id,
          organizationId: upsertedOrg.id,
          role: 'member',
        },
        update: {},
      });
    }

    const session = await this.createSession(user.id, organizationRecord?.id ?? null);
    return {
      needOrganizationSelection: false,
      ...session,
    };
  }

  private async createSession(userId: string, organizationId: string | null) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const organization = await this.resolveOrganizationForSession(user.id, organizationId);

    const token = this.createToken(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.userSession.create({
      data: {
        token,
        userId: user.id,
        organizationId: organization?.id ?? null,
        expiresAt,
      },
    });

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      organization: organization
        ? {
            id: organization.id,
            name: organization.name,
            providerOrganizationId: organization.providerOrganizationId,
          }
        : null,
    };
  }

  private async resolveOrganizationForSession(userId: string, requestedOrganizationId: string | null) {
    if (requestedOrganizationId) {
      const explicitOrganization = await this.prisma.organization.findUnique({
        where: { id: requestedOrganizationId },
      });

      if (explicitOrganization) {
        return {
          id: explicitOrganization.id,
          name: explicitOrganization.name,
          providerOrganizationId: explicitOrganization.providerOrganizationId,
        };
      }
    }

    const membership = await this.prisma.userOrganization.findFirst({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    if (membership?.organization) {
      return {
        id: membership.organization.id,
        name: membership.organization.name,
        providerOrganizationId: membership.organization.providerOrganizationId,
      };
    }

    const singletonOrganizations = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'asc' },
      take: 2,
    });

    if (singletonOrganizations.length !== 1) {
      return null;
    }

    const defaultOrganization = singletonOrganizations[0]!;
    await this.prisma.userOrganization.upsert({
      where: {
        userId_organizationId: {
          userId,
          organizationId: defaultOrganization.id,
        },
      },
      create: {
        userId,
        organizationId: defaultOrganization.id,
        role: 'member',
      },
      update: {},
    });

    return {
      id: defaultOrganization.id,
      name: defaultOrganization.name,
      providerOrganizationId: defaultOrganization.providerOrganizationId,
    };
  }

  private createToken(bytes: number) {
    return randomBytes(bytes).toString('hex');
  }
}
