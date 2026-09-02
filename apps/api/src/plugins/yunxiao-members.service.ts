import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import YunxiaoClient, {
  ListProjectMembersRequest,
} from '@alicloud/devops20210625';
import { $OpenApiUtil } from '@alicloud/openapi-core';

export type YunxiaoProjectMember = {
  identifier: string | null;
  dingTalkId: string | null;
  displayName: string;
  displayRealName: string | null;
  stamp: string | null;
  roleName: string | null;
  roleId: string | null;
};

@Injectable()
export class YunxiaoMembersService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured() {
    return Boolean(this.getPersonalAccessToken() || this.hasAccessKeyCredentials());
  }

  async listProjectMembers(organizationId: string, projectId: string) {
    const personalAccessToken = this.getPersonalAccessToken();
    if (personalAccessToken) {
      return this.listProjectMembersWithPersonalAccessToken(
        organizationId,
        projectId,
        personalAccessToken,
      );
    }

    const accessKeyId = this.configService.get<string>('YUNXIAO_ACCESS_KEY_ID')?.trim();
    const accessKeySecret = this.configService.get<string>('YUNXIAO_ACCESS_KEY_SECRET')?.trim();
    if (!accessKeyId || !accessKeySecret) {
      throw new Error('Yunxiao API credentials are not configured.');
    }

    const client = new YunxiaoClient(new $OpenApiUtil.Config({
      accessKeyId,
      accessKeySecret,
      regionId: this.configService.get<string>('YUNXIAO_REGION_ID')?.trim() || 'cn-hangzhou',
      endpoint: this.configService.get<string>('YUNXIAO_API_ENDPOINT')?.trim() || undefined,
    }));
    const response = await client.listProjectMembers(
      organizationId,
      projectId,
      new ListProjectMembersRequest({ targetType: 'Space' }),
    );
    const body = response.body;
    if (!body?.success) {
      throw new Error('Yunxiao project member API request failed.');
    }

    return this.normalizeMembers(body.members ?? []);
  }

  private async listProjectMembersWithPersonalAccessToken(
    organizationId: string,
    projectId: string,
    personalAccessToken: string,
  ) {
    const endpoint = this.getApiEndpoint();
    const url = new URL(
      `/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/members`,
      endpoint,
    );

    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${personalAccessToken}`,
        'x-yunxiao-token': personalAccessToken,
      },
    });
    let responseBody: unknown = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }
    if (!response.ok) {
      throw new Error(`Yunxiao project member API request failed (${response.status}).`);
    }

    const body = this.asRecord(responseBody);
    const data = this.asRecord(body?.data);
    const members = Array.isArray(responseBody)
      ? responseBody
      : Array.isArray(body?.members)
        ? body.members
        : Array.isArray(body?.data)
          ? body.data
          : Array.isArray(data?.members)
            ? data.members
            : [];
    return this.normalizeMembers(members);
  }

  private normalizeMembers(members: unknown[]) {
    return members
      .map((value) => {
        const member = this.asRecord(value);
        if (!member || member.stamp === 'UserGroup') {
          return null;
        }
        return {
          identifier: this.pickString(member.identifier, member.userId),
          dingTalkId: this.pickString(member.dingTalkId),
          displayName: this.pickString(
            member.userName,
            member.displayName,
            member.displayRealName,
            member.realName,
            member.nickName,
            member.account,
            member.identifier,
          ) ?? '未知云效用户',
          displayRealName: this.pickString(member.displayRealName, member.realName),
          stamp: this.pickString(member.stamp),
          roleName: this.pickString(member.roleName),
          roleId: this.pickString(member.roleId),
        };
      })
      .filter((member): member is YunxiaoProjectMember =>
        member !== null && Boolean(member.identifier));
  }

  private getPersonalAccessToken() {
    return this.configService.get<string>('YUNXIAO_PERSONAL_ACCESS_TOKEN')?.trim() || null;
  }

  private hasAccessKeyCredentials() {
    return Boolean(
      this.configService.get<string>('YUNXIAO_ACCESS_KEY_ID')?.trim()
      && this.configService.get<string>('YUNXIAO_ACCESS_KEY_SECRET')?.trim(),
    );
  }

  private getApiEndpoint() {
    const configuredEndpoint = this.configService.get<string>('YUNXIAO_API_ENDPOINT')?.trim();
    if (configuredEndpoint) {
      return /^https?:\/\//i.test(configuredEndpoint)
        ? configuredEndpoint
        : `https://${configuredEndpoint}`;
    }
    return 'https://openapi-rdc.aliyuncs.com';
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private pickString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }
}
