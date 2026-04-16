import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from './auth-provider.interface';
import {
  ExternalOrganization,
  ExternalUserProfile,
  OAuthExchangeResult,
  ProviderAuthorizeUrlResult,
} from '../types';

@Injectable()
export class DingTalkAuthProvider implements AuthProvider {
  readonly name = 'dingtalk';
  private readonly logger = new Logger(DingTalkAuthProvider.name);

  constructor(private readonly configService: ConfigService) {}

  getAuthorizeUrl(input: {
    state: string;
    redirectUri: string;
  }): ProviderAuthorizeUrlResult {
    const appId = this.configService.get<string>('DINGTALK_APP_ID');
    const scope = this.configService.get<string>('DINGTALK_SCOPE') ?? 'openid corpid';
    const prompt = this.configService.get<string>('DINGTALK_PROMPT') ?? 'consent';
    const forceLogin = this.configService.get<string>('DINGTALK_FE_FORCE_LOGIN') ?? 'true';
    const authorizeBase =
      this.configService.get<string>('DINGTALK_AUTHORIZE_URL') ??
      'https://login.dingtalk.com/oauth2/challenge.htm';

    if (!appId) {
      throw new Error('DINGTALK_APP_ID is not configured.');
    }

    const url = new URL(authorizeBase);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', input.state);
    if (prompt) {
      url.searchParams.set('prompt', prompt);
    }
    if (forceLogin) {
      url.searchParams.set('FEForceLogin', forceLogin);
    }
    return { url: url.toString() };
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<OAuthExchangeResult> {
    const appId = this.configService.get<string>('DINGTALK_APP_ID');
    const appSecret = this.configService.get<string>('DINGTALK_APP_SECRET');
    if (!appId || !appSecret) {
      throw new Error('DINGTALK_APP_ID / DINGTALK_APP_SECRET is not configured.');
    }

    const tokenUrl =
      this.configService.get<string>('DINGTALK_TOKEN_URL') ??
      'https://api.dingtalk.com/v1.0/oauth2/userAccessToken';
    const profileUrl =
      this.configService.get<string>('DINGTALK_PROFILE_URL') ??
      'https://api.dingtalk.com/v1.0/contact/users/me';
    const orgsUrl =
      this.configService.get<string>('DINGTALK_ORGS_URL') ??
      'https://api.dingtalk.com/v1.0/contact/scopes/organizations';
    const ownedOrganizationsUrl =
      this.configService.get<string>('DINGTALK_OWNED_ORGS_URL') ??
      'https://api.dingtalk.com/v1.0/contact/orgAccounts/ownedOrganizations';
    const appAccessTokenUrl =
      this.configService.get<string>('DINGTALK_APP_ACCESS_TOKEN_URL') ??
      'https://api.dingtalk.com/v1.0/oauth2/{corpId}/token';
    const getUserByUnionIdUrl =
      this.configService.get<string>('DINGTALK_GET_USER_BY_UNION_ID_URL') ??
      'https://oapi.dingtalk.com/topapi/user/getbyunionid';

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: appId,
        clientSecret: appSecret,
        code: input.code,
        grantType: 'authorization_code',
        redirectUri: input.redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      throw new Error('Failed to exchange DingTalk code.');
    }
    const tokenJson = (await tokenRes.json()) as {
      accessToken?: string;
      corpId?: string;
      corpid?: string;
    };
    if (!tokenJson.accessToken) {
      throw new Error('DingTalk access token is missing.');
    }

    const [profileRes, orgsRes] = await Promise.all([
      fetch(profileUrl, {
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': tokenJson.accessToken,
        },
      }),
      fetch(orgsUrl, {
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': tokenJson.accessToken,
        },
      }),
    ]);

    if (!profileRes.ok) {
      throw new Error('Failed to fetch DingTalk user profile.');
    }

    const profileJson = (await profileRes.json()) as Record<string, unknown>;
    const orgsJson = orgsRes.ok
      ? ((await orgsRes.json()) as { organizations?: Array<Record<string, unknown>> })
      : { organizations: [] };
    if (!orgsRes.ok) {
      const orgsErrBody = await orgsRes.text().catch(() => '');
      this.logger.warn(`DINGTALK_SCOPED_ORGS_REQUEST_FAILED status=${orgsRes.status} body=${orgsErrBody}`);
    }
    const scopedOrganizations = Array.isArray((orgsJson as { organizations?: unknown }).organizations)
      ? ((orgsJson as { organizations: Array<Record<string, unknown>> }).organizations ?? [])
      : [];
    const firstScopedOrganization = scopedOrganizations[0];
    this.logger.debug(
      `DINGTALK_SCOPED_ORGS_SHAPE status=${orgsRes.status} count=${scopedOrganizations.length} topLevelKeys=${Object.keys(
        orgsJson as Record<string, unknown>,
      ).join(',') || 'none'} firstItemKeys=${
        firstScopedOrganization ? Object.keys(firstScopedOrganization).join(',') : 'none'
      }`,
    );

    const profile: ExternalUserProfile = {
      userId: String(profileJson.unionId ?? profileJson.openId ?? profileJson.userid ?? `dd_${Date.now()}`),
      unionId: profileJson.unionId ? String(profileJson.unionId) : undefined,
      displayName: String(profileJson.nick ?? profileJson.name ?? '钉钉用户'),
      email: profileJson.email ? String(profileJson.email) : undefined,
      avatarUrl: profileJson.avatarUrl ? String(profileJson.avatarUrl) : undefined,
      raw: profileJson,
    };
    const organizationUserId =
      typeof profileJson.userid === 'string'
        ? profileJson.userid.trim()
        : typeof profileJson.userId === 'string'
          ? profileJson.userId.trim()
          : '';

    const organizations: ExternalOrganization[] = scopedOrganizations.map((item) => ({
      id: String(item.corpId ?? item.organizationId ?? item.id),
      name: String(item.name ?? item.organizationName ?? item.title ?? '未命名组织'),
      logoUrl: item.logoUrl ? String(item.logoUrl) : undefined,
    }));

    const selectedOrganizationId = tokenJson.corpId?.trim() || tokenJson.corpid?.trim();
    if (selectedOrganizationId) {
      const matchedOrganization = organizations.find(
        (organization) => organization.id === selectedOrganizationId,
      );
      if (matchedOrganization) {
        return {
          profile,
          organizations: [matchedOrganization],
        };
      }

      if (organizations.length === 0) {
        const orgName = await this.fetchOrganizationName({
          corpId: selectedOrganizationId,
          appId,
          appSecret,
        });

        if (orgName) {
          return {
            profile,
            organizations: [
              {
                id: selectedOrganizationId,
                name: orgName,
              },
            ],
          };
        }

        const resolvedOrganizationUserId = await this.resolveOrganizationUserId({
          organizationUserId,
          unionId: profile.unionId?.trim() ?? '',
          selectedOrganizationId,
          appId,
          appSecret,
          appAccessTokenUrl,
          getUserByUnionIdUrl,
        });
        const ownedOrganizationName = await this.fetchOwnedOrganizationName({
          accessToken: tokenJson.accessToken,
          ownedOrganizationsUrl,
          selectedOrganizationId,
          organizationUserId: resolvedOrganizationUserId,
        });
        if (!ownedOrganizationName) {
          this.logger.warn(
            `DINGTALK_ORG_NAME_FALLBACK corpId=${selectedOrganizationId} organizations=0 profileUserId=${organizationUserId || 'missing'} unionId=${profile.unionId ? 'present' : 'missing'} resolvedUserId=${resolvedOrganizationUserId || 'missing'}`,
          );
        }
        return {
          profile,
          organizations: [
            {
              id: selectedOrganizationId,
              name: ownedOrganizationName || '钉钉组织',
            },
          ],
        };
      }
    }

    return {
      profile,
      organizations,
    };
  }

  private async fetchOwnedOrganizationName(input: {
    accessToken: string;
    ownedOrganizationsUrl: string;
    selectedOrganizationId: string;
    organizationUserId: string;
  }) {
    if (!input.organizationUserId) {
      this.logger.warn(
        `DINGTALK_ORG_USERID_MISSING corpId=${input.selectedOrganizationId}`,
      );
      return '';
    }

    const url = new URL(input.ownedOrganizationsUrl);
    url.searchParams.set('userId', input.organizationUserId);

    const response = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': input.accessToken,
      },
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      this.logger.warn(
        `DINGTALK_OWNED_ORGS_REQUEST_FAILED corpId=${input.selectedOrganizationId} userId=${input.organizationUserId} status=${response.status} body=${errBody}`,
      );
      return '';
    }

    const json = (await response.json()) as {
      organizations?: Array<Record<string, unknown>>;
      orgList?: Array<Record<string, unknown>>;
      result?: {
        organizations?: Array<Record<string, unknown>>;
        orgList?: Array<Record<string, unknown>>;
      };
    };
    const organizations =
      json.organizations ??
      json.orgList ??
      json.result?.organizations ??
      json.result?.orgList ??
      [];
    const matchedOrganization = organizations.find((organization) => {
      const organizationId = String(
        organization.corpId ?? organization.organizationId ?? organization.id ?? '',
      ).trim();
      return organizationId === input.selectedOrganizationId;
    });

    if (!matchedOrganization) {
      this.logger.warn(
        `DINGTALK_OWNED_ORGS_NO_MATCH corpId=${input.selectedOrganizationId} userId=${input.organizationUserId} returnedKeys=${Object.keys(
          json,
        ).join(',')}`,
      );
      return '';
    }

    return String(
      matchedOrganization.corpName ??
        matchedOrganization.name ??
        matchedOrganization.organizationName ??
        matchedOrganization.title ??
        '',
    ).trim();
  }

  private async fetchOrganizationName(input: {
    corpId: string;
    appId: string;
    appSecret: string;
  }): Promise<string> {
    const appTokenUrl =
      this.configService.get<string>('DINGTALK_APP_TOKEN_URL') ??
      'https://api.dingtalk.com/v1.0/oauth2/accessToken';

    const appTokenResponse = await fetch(appTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appKey: input.appId,
        appSecret: input.appSecret,
      }),
    });
    if (!appTokenResponse.ok) {
      const errBody = await appTokenResponse.text().catch(() => '');
      this.logger.warn(
        `DINGTALK_APP_TOKEN_REQUEST_FAILED status=${appTokenResponse.status} body=${errBody}`,
      );
      return '';
    }

    const appTokenJson = (await appTokenResponse.json()) as {
      accessToken?: string;
    };
    const appAccessToken = appTokenJson.accessToken ?? '';
    if (!appAccessToken) {
      this.logger.warn('DINGTALK_APP_TOKEN_MISSING');
      return '';
    }

    const authInfoUrl =
      this.configService.get<string>('DINGTALK_ORG_AUTH_INFO_URL') ??
      `https://api.dingtalk.com/v1.0/contact/organizations/authInfos?targetCorpId=${encodeURIComponent(input.corpId)}`;

    const authInfoResponse = await fetch(authInfoUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': appAccessToken,
      },
    });
    if (!authInfoResponse.ok) {
      const errBody = await authInfoResponse.text().catch(() => '');
      this.logger.warn(
        `DINGTALK_ORG_AUTH_INFO_REQUEST_FAILED corpId=${input.corpId} status=${authInfoResponse.status} body=${errBody}`,
      );
      return '';
    }

    const authInfoJson = (await authInfoResponse.json()) as {
      orgName?: string;
      result?: {
        orgName?: string;
      };
    };

    const orgName = authInfoJson.orgName ?? authInfoJson.result?.orgName ?? '';
    if (!orgName) {
      this.logger.warn(
        `DINGTALK_ORG_AUTH_INFO_EMPTY corpId=${input.corpId} responseKeys=${Object.keys(authInfoJson).join(',')}`,
      );
    }

    return orgName;
  }

  private async resolveOrganizationUserId(input: {
    organizationUserId: string;
    unionId: string;
    selectedOrganizationId: string;
    appId: string;
    appSecret: string;
    appAccessTokenUrl: string;
    getUserByUnionIdUrl: string;
  }) {
    if (input.organizationUserId) {
      return input.organizationUserId;
    }

    if (!input.unionId) {
      this.logger.warn('DINGTALK_UNIONID_MISSING');
      return '';
    }

    const appTokenUrl = input.appAccessTokenUrl.includes('{corpId}')
      ? input.appAccessTokenUrl.replace(
          '{corpId}',
          encodeURIComponent(input.selectedOrganizationId),
        )
      : input.appAccessTokenUrl;

    const appTokenResponse = await fetch(appTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: input.appId,
        client_secret: input.appSecret,
        grant_type: 'client_credentials',
      }),
    });
    if (!appTokenResponse.ok) {
      const errBody = await appTokenResponse.text().catch(() => '');
      this.logger.warn(
        `DINGTALK_APP_TOKEN_REQUEST_FAILED status=${appTokenResponse.status} body=${errBody}`,
      );
      return '';
    }

    const appTokenJson = (await appTokenResponse.json()) as {
      access_token?: string;
      accessToken?: string;
    };
    const appAccessToken = appTokenJson.access_token ?? appTokenJson.accessToken ?? '';
    if (!appAccessToken) {
      this.logger.warn('DINGTALK_APP_TOKEN_MISSING');
      return '';
    }

    const url = new URL(input.getUserByUnionIdUrl);
    url.searchParams.set('access_token', appAccessToken);
    const userResponse = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unionid: input.unionId,
      }),
    });
    if (!userResponse.ok) {
      const errBody = await userResponse.text().catch(() => '');
      this.logger.warn(
        `DINGTALK_GET_USER_BY_UNIONID_REQUEST_FAILED status=${userResponse.status} body=${errBody}`,
      );
      return '';
    }

    const userJson = (await userResponse.json()) as {
      result?: { userid?: string; userId?: string };
      userid?: string;
      userId?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (typeof userJson.errcode === 'number' && userJson.errcode !== 0) {
      this.logger.warn(
        `DINGTALK_GET_USER_BY_UNIONID_FAILED errcode=${userJson.errcode} errmsg=${userJson.errmsg ?? 'unknown'}`,
      );
      return '';
    }

    const resolvedUserId =
      userJson.result?.userid?.trim() ??
      userJson.result?.userId?.trim() ??
      userJson.userid?.trim() ??
      userJson.userId?.trim() ??
      '';
    if (!resolvedUserId) {
      this.logger.warn('DINGTALK_GET_USER_BY_UNIONID_EMPTY');
    }

    return resolvedUserId;
  }
}
