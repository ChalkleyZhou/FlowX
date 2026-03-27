import { Injectable } from '@nestjs/common';
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
    const tokenJson = (await tokenRes.json()) as { accessToken?: string };
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

    const profile: ExternalUserProfile = {
      userId: String(profileJson.unionId ?? profileJson.openId ?? profileJson.userid ?? `dd_${Date.now()}`),
      unionId: profileJson.unionId ? String(profileJson.unionId) : undefined,
      displayName: String(profileJson.nick ?? profileJson.name ?? '钉钉用户'),
      email: profileJson.email ? String(profileJson.email) : undefined,
      avatarUrl: profileJson.avatarUrl ? String(profileJson.avatarUrl) : undefined,
      raw: profileJson,
    };

    const organizations: ExternalOrganization[] = (orgsJson.organizations ?? []).map((item) => ({
      id: String(item.corpId ?? item.organizationId ?? item.id),
      name: String(item.name ?? item.organizationName ?? item.title ?? '未命名组织'),
      logoUrl: item.logoUrl ? String(item.logoUrl) : undefined,
    }));

    // Internal apps may not expose multiple organizations through this API, so we
    // keep a deterministic fallback organization to preserve the selection flow.
    const fallbackOrgId = profile.unionId ?? profile.userId;
    return {
      profile,
      organizations:
        organizations.length > 0
          ? organizations
          : [{ id: `org_${fallbackOrgId}`, name: '默认组织' }],
    };
  }
}
