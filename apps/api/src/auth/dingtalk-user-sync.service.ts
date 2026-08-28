import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type DingTalkDirectoryUser = {
  staffId: string;
  unionId: string | null;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  active: boolean | null;
};

export type DingTalkUserSyncResult = {
  total: number;
  created: number;
  updated: number;
  addedToOrganization: number;
};

@Injectable()
export class DingTalkUserSyncService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async syncOrganizationUsers(
    organizationId: string,
    corpId: string,
  ): Promise<DingTalkUserSyncResult> {
    const accessToken = await this.fetchAccessToken();
    const directoryUsers = await this.fetchDirectoryUsers(accessToken);
    const identityKeys = directoryUsers.flatMap((user) => [
      this.identityKey(corpId, user),
      ...(user.unionId ? [user.unionId] : []),
    ]);
    const unionIds = directoryUsers.flatMap((user) => user.unionId ? [user.unionId] : []);

    const existingIdentities = directoryUsers.length > 0
      ? await this.prisma.authIdentity.findMany({
          where: {
            provider: 'dingtalk',
            OR: [
              { providerUserId: { in: identityKeys } },
              ...(unionIds.length > 0 ? [{ providerUnionId: { in: unionIds } }] : []),
            ],
          },
        })
      : [];
    const identitiesByKey = new Map<string, (typeof existingIdentities)[number]>();
    for (const identity of existingIdentities) {
      identitiesByKey.set(identity.providerUserId, identity);
      if (identity.providerUnionId) {
        identitiesByKey.set(identity.providerUnionId, identity);
      }
    }

    const existingMemberships = await this.prisma.userOrganization.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const memberUserIds = new Set(existingMemberships.map((membership) => membership.userId));

    const result: DingTalkUserSyncResult = {
      total: directoryUsers.length,
      created: 0,
      updated: 0,
      addedToOrganization: 0,
    };

    for (const directoryUser of directoryUsers) {
      await this.prisma.$transaction(async (tx) => {
        const key = this.identityKey(corpId, directoryUser);
        const existingIdentity = identitiesByKey.get(directoryUser.unionId ?? key)
          ?? identitiesByKey.get(key);
        const profile = this.toRawProfile(directoryUser);
        let userId: string;

        if (existingIdentity) {
          userId = existingIdentity.userId;
          await tx.user.update({
            where: { id: userId },
            data: this.toUserUpdate(directoryUser),
          });
          await tx.authIdentity.update({
            where: { id: existingIdentity.id },
            data: {
              providerUnionId: directoryUser.unionId,
              providerRawProfile: profile,
            },
          });
          result.updated += 1;
        } else {
          const userWithEmail = directoryUser.email
            ? await tx.user.findUnique({ where: { email: directoryUser.email } })
            : null;
          const user = userWithEmail ?? await tx.user.create({
            data: {
              displayName: directoryUser.displayName,
              avatarUrl: directoryUser.avatarUrl,
              email: directoryUser.email,
            },
          });
          userId = user.id;
          await tx.authIdentity.create({
            data: {
              userId,
              provider: 'dingtalk',
              providerUserId: key,
              providerUnionId: directoryUser.unionId,
              providerRawProfile: profile,
            },
          });
          if (userWithEmail) {
            await tx.user.update({
              where: { id: userId },
              data: this.toUserUpdate(directoryUser),
            });
            result.updated += 1;
          } else {
            result.created += 1;
          }
        }

        if (!memberUserIds.has(userId)) {
          await tx.userOrganization.upsert({
            where: {
              userId_organizationId: {
                userId,
                organizationId,
              },
            },
            create: {
              userId,
              organizationId,
              role: 'member',
            },
            update: {},
          });
          memberUserIds.add(userId);
          result.addedToOrganization += 1;
        }
      });
    }

    return result;
  }

  private async fetchAccessToken() {
    const appKey = this.configService.get<string>('DINGTALK_APP_ID')?.trim();
    const appSecret = this.configService.get<string>('DINGTALK_APP_SECRET')?.trim();
    if (!appKey || !appSecret) {
      throw new ServiceUnavailableException(
        'DingTalk user synchronization requires DINGTALK_APP_ID and DINGTALK_APP_SECRET.',
      );
    }

    const url = this.configService.get<string>('DINGTALK_APP_TOKEN_URL')?.trim()
      || 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey, appSecret }),
    });
    const payload = await this.readJson(response);
    const accessToken = this.pickString(payload.accessToken, payload.access_token);
    if (!response.ok || !accessToken) {
      throw new BadGatewayException('DingTalk rejected the app access token request.');
    }
    return accessToken;
  }

  private async fetchDirectoryUsers(accessToken: string) {
    const users = new Map<string, DingTalkDirectoryUser>();
    const pendingDepartmentIds: number[] = [1];
    const visitedDepartmentIds = new Set<number>();

    while (pendingDepartmentIds.length > 0) {
      const departmentId = pendingDepartmentIds.shift();
      if (departmentId === undefined || visitedDepartmentIds.has(departmentId)) {
        continue;
      }
      visitedDepartmentIds.add(departmentId);
      if (visitedDepartmentIds.size > 10_000) {
        throw new BadGatewayException('DingTalk returned too many departments to synchronize safely.');
      }

      for (const user of await this.fetchDepartmentUsers(accessToken, departmentId)) {
        users.set(user.staffId, user);
      }
      for (const childId of await this.fetchChildDepartmentIds(accessToken, departmentId)) {
        if (!visitedDepartmentIds.has(childId)) {
          pendingDepartmentIds.push(childId);
        }
      }
    }

    return [...users.values()];
  }

  private async fetchDepartmentUsers(accessToken: string, departmentId: number) {
    const users: DingTalkDirectoryUser[] = [];
    let cursor = 0;
    const seenCursors = new Set<number>();

    while (!seenCursors.has(cursor)) {
      seenCursors.add(cursor);
      const payload = await this.callLegacyApi(
        this.configService.get<string>('DINGTALK_USER_LIST_URL')?.trim()
          || 'https://oapi.dingtalk.com/topapi/v2/user/list',
        accessToken,
        { dept_id: departmentId, cursor, size: 100, language: 'zh_CN' },
      );
      const result = this.asRecord(payload.result);
      const list = Array.isArray(result?.list) ? result.list : [];
      for (const item of list) {
        const normalized = this.normalizeUser(item);
        if (normalized) {
          users.push(normalized);
        }
      }

      if (result?.has_more !== true) {
        break;
      }
      const nextCursor = Number(result.next_cursor);
      if (!Number.isFinite(nextCursor)) {
        throw new BadGatewayException('DingTalk returned an invalid user pagination cursor.');
      }
      cursor = nextCursor;
    }
    return users;
  }

  private async fetchChildDepartmentIds(accessToken: string, departmentId: number) {
    const payload = await this.callLegacyApi(
      this.configService.get<string>('DINGTALK_DEPARTMENT_LIST_URL')?.trim()
        || 'https://oapi.dingtalk.com/topapi/v2/department/listsubid',
      accessToken,
      { dept_id: departmentId },
    );
    const result = this.asRecord(payload.result);
    const ids = Array.isArray(result?.dept_id_list) ? result.dept_id_list : [];
    return ids
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
  }

  private async callLegacyApi(
    endpoint: string,
    accessToken: string,
    body: Record<string, unknown>,
  ) {
    const url = new URL(endpoint);
    url.searchParams.set('access_token', accessToken);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await this.readJson(response);
    if (!response.ok || Number(payload.errcode ?? 0) !== 0) {
      throw new BadGatewayException(this.formatDirectoryError(payload));
    }
    return payload;
  }

  private formatDirectoryError(payload: Record<string, unknown>) {
    const errorCode = Number(payload.errcode);
    const errorMessage = typeof payload.errmsg === 'string' ? payload.errmsg : '';
    const missingScopes = [
      'qyapi_get_department_member',
      'qyapi_get_department_list',
    ].filter((scope) => errorMessage.includes(scope));

    if (missingScopes.length > 0) {
      return `DingTalk app is missing required permission: ${missingScopes.join(', ')}.`;
    }
    if (Number.isFinite(errorCode)) {
      return `DingTalk directory request failed (error code ${errorCode}).`;
    }
    return 'DingTalk directory request failed.';
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadGatewayException('DingTalk returned an invalid response.');
    }
    return payload as Record<string, unknown>;
  }

  private normalizeUser(value: unknown): DingTalkDirectoryUser | null {
    const user = this.asRecord(value);
    const staffId = this.pickString(user?.userid, user?.userId);
    if (!user || !staffId) {
      return null;
    }
    return {
      staffId,
      unionId: this.pickString(user.unionid, user.unionId),
      displayName: this.pickString(user.name, user.nick) ?? staffId,
      avatarUrl: this.pickString(user.avatar),
      email: this.pickString(user.org_email, user.email),
      active: typeof user.active === 'boolean' ? user.active : null,
    };
  }

  private identityKey(corpId: string, user: DingTalkDirectoryUser) {
    return user.unionId ?? `staff:${corpId}:${user.staffId}`;
  }

  private toUserUpdate(user: DingTalkDirectoryUser): Prisma.UserUpdateInput {
    return {
      displayName: user.displayName,
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      ...(user.email ? { email: user.email } : {}),
    };
  }

  private toRawProfile(user: DingTalkDirectoryUser): Prisma.InputJsonValue {
    return {
      userid: user.staffId,
      ...(user.unionId ? { unionId: user.unionId } : {}),
      name: user.displayName,
      ...(user.avatarUrl ? { avatar: user.avatarUrl } : {}),
      ...(user.email ? { email: user.email } : {}),
      ...(user.active !== null ? { active: user.active } : {}),
    };
  }

  private pickString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private asRecord(value: unknown) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }
}
