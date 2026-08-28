import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { DingTalkNotificationService } from '../notifications/dingtalk-notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { PersonalApiTokenService } from './personal-api-token.service';
import { DingTalkUserSyncService } from './dingtalk-user-sync.service';
import { ProviderRegistryService } from './providers/provider-registry.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly passwordService: PasswordService,
    @Optional()
    @Inject(DingTalkNotificationService)
    private readonly dingTalkNotification?: DingTalkNotificationService,
    @Optional()
    private readonly personalApiTokenService?: PersonalApiTokenService,
    @Optional()
    private readonly dingTalkUserSyncService?: DingTalkUserSyncService,
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
    const origin = new URL(input.backendOrigin);
    const pathPrefix = origin.port === '3000' ? '' : '/api';
    return new URL(`${pathPrefix}/auth/${providerName}/callback`, origin).toString();
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

    const sessionMembership = session.organizationId
      ? await this.prisma.userOrganization.findUnique({
          where: {
            userId_organizationId: {
              userId: session.userId,
              organizationId: session.organizationId,
            },
          },
          include: { organization: true },
        })
      : null;
    if (session.organizationId && !sessionMembership) {
      throw new UnauthorizedException('Organization access revoked.');
    }

    const resolvedOrganization = sessionMembership
      ? {
          id: sessionMembership.organization.id,
          name: sessionMembership.organization.name,
          provider: sessionMembership.organization.provider,
          providerOrganizationId: sessionMembership.organization.providerOrganizationId,
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

    const organizationRole = sessionMembership?.role
      ?? (resolvedOrganization
        ? await this.getOrganizationRole(resolvedOrganization.id, session.userId)
        : null);

    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      },
      organization: resolvedOrganization
        ? {
            ...resolvedOrganization,
            role: organizationRole,
          }
        : null,
    };
  }

  async resolveBearerAuth(bearerToken: string) {
    const token = bearerToken.trim();
    if (token.startsWith('fxpat_')) {
      if (!this.personalApiTokenService) {
        throw new UnauthorizedException('Personal API token authentication is unavailable.');
      }
      const pat = await this.personalApiTokenService.resolveToken(token);
      const role = await this.getOrganizationRole(pat.organization.id, pat.user.id);
      if (!role) {
        throw new UnauthorizedException('Organization access revoked.');
      }
      return {
        token,
        expiresAt: null as Date | null,
        authKind: 'personal_api_token' as const,
        user: pat.user,
        organization: { ...pat.organization, role },
      };
    }
    const session = await this.getSession(token);
    return { ...session, authKind: 'user_session' as const };
  }

  async listOrganizationMembers(organizationId: string) {
    const rows = await this.prisma.userOrganization.findMany({
      where: { organizationId },
      include: {
        user: {
          include: { localCredential: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.user.id,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
      account: row.user.localCredential?.account ?? row.user.account,
      email: row.user.email,
      role: row.role,
      status: row.user.status,
      joinedAt: row.createdAt.toISOString(),
    }));
  }

  async syncDingTalkOrganizationUsers(organizationId: string, actingUserId: string) {
    await this.requireOrganizationAdmin(organizationId, actingUserId);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }
    if (organization.provider !== 'dingtalk') {
      throw new BadRequestException('Current organization is not connected to DingTalk.');
    }
    if (!this.dingTalkUserSyncService) {
      throw new BadRequestException('DingTalk user synchronization is unavailable.');
    }
    return this.dingTalkUserSyncService.syncOrganizationUsers(
      organizationId,
      organization.providerOrganizationId,
    );
  }

  async resolveOrganizationMemberEmail(organizationId: string, userId: string) {
    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      include: { user: true },
    });

    if (!membership) {
      throw new NotFoundException('Organization member not found.');
    }

    const cachedEmail = membership.user.email?.trim();
    if (cachedEmail) {
      return {
        email: cachedEmail,
        source: 'profile' as const,
      };
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (
      organization?.provider === 'dingtalk' &&
      organization.providerOrganizationId?.trim() &&
      this.dingTalkNotification
    ) {
      const resolvedEmail = await this.dingTalkNotification.fetchStaffEmail(
        userId,
        organization.providerOrganizationId.trim(),
      );
      if (resolvedEmail) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { email: resolvedEmail },
        });
        return {
          email: resolvedEmail,
          source: 'dingtalk' as const,
        };
      }
    }

    throw new BadRequestException(
      'Member email is unavailable. Ask the user to sign in with DingTalk or enter an email manually.',
    );
  }

  async createOrganizationMember(
    organizationId: string,
    actingUserId: string,
    input: {
      account: string;
      password?: string;
      displayName?: string;
    },
  ) {
    await this.requireOrganizationAdmin(organizationId, actingUserId);

    const account = input.account.trim().toLowerCase();
    const role = 'member';
    const existingCredential = await this.prisma.localCredential.findUnique({
      where: { account },
      include: { user: true },
    });

    if (existingCredential) {
      const existingMembership = await this.prisma.userOrganization.findUnique({
        where: {
          userId_organizationId: {
            userId: existingCredential.userId,
            organizationId,
          },
        },
      });
      if (existingMembership) {
        throw new ConflictException('User is already a member of this organization.');
      }

      await this.prisma.userOrganization.create({
        data: {
          userId: existingCredential.userId,
          organizationId,
          role,
        },
      });

      return this.getOrganizationMember(organizationId, existingCredential.userId);
    }

    if (!input.password?.trim()) {
      throw new BadRequestException('Password is required when creating a new account.');
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
        memberships: {
          create: {
            organizationId,
            role,
          },
        },
      },
    });

    return this.getOrganizationMember(organizationId, user.id);
  }

  async updateOrganizationMember(
    organizationId: string,
    actingUserId: string,
    userId: string,
    input: {
      displayName?: string;
      status?: 'ACTIVE' | 'DISABLED';
    },
  ) {
    await this.requireOrganizationAdmin(organizationId, actingUserId);

    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });
    if (!membership) {
      throw new NotFoundException('Organization member not found.');
    }

    const userUpdates: Prisma.UserUpdateInput = {};
    if (input.displayName !== undefined) {
      userUpdates.displayName = input.displayName.trim();
    }
    if (input.status !== undefined) {
      userUpdates.status = input.status;
    }

    if (Object.keys(userUpdates).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: userUpdates,
      });
    }

    return this.getOrganizationMember(organizationId, userId);
  }

  async transferOrganizationAdmin(
    organizationId: string,
    actingUserId: string,
    targetUserId: string,
  ) {
    if (actingUserId === targetUserId) {
      throw new BadRequestException('Cannot transfer admin role to yourself.');
    }

    const actingMembership = await this.requireOrganizationAdmin(organizationId, actingUserId);

    const targetMembership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: targetUserId,
          organizationId,
        },
      },
    });
    if (!targetMembership) {
      throw new NotFoundException('Organization member not found.');
    }
    if (targetMembership.role === 'admin') {
      throw new BadRequestException('Target user is already an organization admin.');
    }

    await this.prisma.$transaction([
      this.prisma.userOrganization.update({
        where: { id: actingMembership.id },
        data: { role: 'member' },
      }),
      this.prisma.userOrganization.update({
        where: { id: targetMembership.id },
        data: { role: 'admin' },
      }),
    ]);

    return this.getOrganizationMember(organizationId, targetUserId);
  }

  async removeOrganizationMember(
    organizationId: string,
    userId: string,
    actingUserId: string,
  ) {
    await this.requireOrganizationAdmin(organizationId, actingUserId);

    if (userId === actingUserId) {
      throw new BadRequestException('You cannot remove yourself from the organization.');
    }

    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });
    if (!membership) {
      throw new NotFoundException('Organization member not found.');
    }
    if (membership.role === 'admin') {
      const adminCount = await this.countOrganizationAdmins(organizationId);
      if (adminCount <= 1) {
        throw new BadRequestException(
          'Cannot remove the only organization admin. Transfer admin role first.',
        );
      }
    }

    const revokedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.userOrganization.delete({
        where: { id: membership.id },
      }),
      this.prisma.userSession.deleteMany({
        where: { userId, organizationId },
      }),
      this.prisma.personalApiToken.updateMany({
        where: { userId, organizationId, revokedAt: null },
        data: { revokedAt },
      }),
    ]);

    return { removed: true };
  }

  private async resolveInitialMembershipRole(organizationId: string): Promise<'admin' | 'member'> {
    const memberCount = await this.prisma.userOrganization.count({
      where: { organizationId },
    });
    return memberCount === 0 ? 'admin' : 'member';
  }

  private async getOrganizationRole(organizationId: string, userId: string) {
    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });
    return membership?.role ?? null;
  }

  private async requireOrganizationAdmin(organizationId: string, actingUserId: string) {
    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: actingUserId,
          organizationId,
        },
      },
    });
    if (!membership || membership.role !== 'admin') {
      throw new ForbiddenException('Organization admin permission required.');
    }
    return membership;
  }

  private async countOrganizationAdmins(organizationId: string) {
    return this.prisma.userOrganization.count({
      where: { organizationId, role: 'admin' },
    });
  }

  private async getOrganizationMember(organizationId: string, userId: string) {
    const row = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      include: {
        user: {
          include: { localCredential: true },
        },
      },
    });
    if (!row) {
      throw new NotFoundException('Organization member not found.');
    }

    return {
      id: row.user.id,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
      account: row.user.localCredential?.account ?? row.user.account,
      email: row.user.email,
      role: row.role,
      status: row.user.status,
      joinedAt: row.createdAt.toISOString(),
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

    const displayName = input.displayName?.trim() || account;
    const passwordHash = this.passwordService.hashPassword(input.password);
    const { user, organization } = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          account,
          displayName,
          localCredential: {
            create: {
              account,
              passwordHash,
            },
          },
        },
      });
      const createdOrganization = await tx.organization.create({
        data: {
          provider: 'local',
          providerOrganizationId: `local:${createdUser.id}`,
          name: `${displayName} 的组织`,
        },
      });
      await tx.userOrganization.create({
        data: {
          userId: createdUser.id,
          organizationId: createdOrganization.id,
          role: 'admin',
        },
      });
      return {
        user: createdUser,
        organization: createdOrganization,
      };
    });

    return this.createSession(user.id, organization.id);
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

    const organizationId = await this.ensurePasswordUserOrganization({
      id: credential.userId,
      displayName: credential.user.displayName,
    });
    return this.createSession(credential.userId, organizationId);
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

      const initialRole = await this.resolveInitialMembershipRole(upsertedOrg.id);
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
          role: initialRole,
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

  async createShortLivedSession(
    userId: string,
    organizationId: string | null,
    ttlMs = 2 * 60 * 60 * 1000,
  ) {
    const session = await this.createSession(userId, organizationId, { ttlMs });
    return {
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  private async createSession(
    userId: string,
    organizationId: string | null,
    options?: { ttlMs?: number },
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const organization = await this.resolveOrganizationForSession(
      user.id,
      organizationId,
    );
    const organizationRole = organization
      ? await this.getOrganizationRole(organization.id, user.id)
      : null;

    const token = this.createToken(32);
    const ttlMs = options?.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);
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
            provider: organization.provider,
            providerOrganizationId: organization.providerOrganizationId,
            role: organizationRole,
          }
        : null,
    };
  }

  private async resolveOrganizationForSession(
    userId: string,
    requestedOrganizationId: string | null,
  ) {
    if (requestedOrganizationId) {
      const explicitMembership = await this.prisma.userOrganization.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId: requestedOrganizationId,
          },
        },
        include: { organization: true },
      });

      if (explicitMembership?.organization) {
        return {
          id: explicitMembership.organization.id,
          name: explicitMembership.organization.name,
          provider: explicitMembership.organization.provider,
          providerOrganizationId: explicitMembership.organization.providerOrganizationId,
        };
      }
      return null;
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
        provider: membership.organization.provider,
        providerOrganizationId: membership.organization.providerOrganizationId,
      };
    }

    return null;
  }

  private async ensurePasswordUserOrganization(user: { id: string; displayName: string }) {
    const membership = await this.prisma.userOrganization.findFirst({
      where: { userId: user.id },
      select: { organizationId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (membership) {
      return membership.organizationId;
    }

    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.upsert({
        where: {
          provider_providerOrganizationId: {
            provider: 'local',
            providerOrganizationId: `local:${user.id}`,
          },
        },
        create: {
          provider: 'local',
          providerOrganizationId: `local:${user.id}`,
          name: `${user.displayName} 的组织`,
        },
        update: {},
      });
      await tx.userOrganization.upsert({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: organization.id,
          },
        },
        create: {
          userId: user.id,
          organizationId: organization.id,
          role: 'admin',
        },
        update: {},
      });
      return organization.id;
    });
  }

  private createToken(bytes: number) {
    return randomBytes(bytes).toString('hex');
  }
}
