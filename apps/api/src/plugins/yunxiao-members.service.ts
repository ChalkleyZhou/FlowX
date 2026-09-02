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
};

@Injectable()
export class YunxiaoMembersService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured() {
    return Boolean(
      this.configService.get<string>('YUNXIAO_ACCESS_KEY_ID')?.trim()
      && this.configService.get<string>('YUNXIAO_ACCESS_KEY_SECRET')?.trim(),
    );
  }

  async listProjectMembers(organizationId: string, projectId: string) {
    const accessKeyId = this.configService.get<string>('YUNXIAO_ACCESS_KEY_ID')?.trim();
    const accessKeySecret = this.configService.get<string>('YUNXIAO_ACCESS_KEY_SECRET')?.trim();
    if (!accessKeyId || !accessKeySecret) {
      throw new Error('Yunxiao OpenAPI credentials are not configured.');
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

    return (body.members ?? [])
      .filter((member) => member.stamp !== 'UserGroup')
      .map((member) => ({
        identifier: this.pickString(member.identifier),
        dingTalkId: this.pickString(member.dingTalkId),
        displayName: this.pickString(
          member.displayName,
          member.displayRealName,
          member.realName,
          member.nickName,
          member.account,
          member.identifier,
        ) ?? '未知云效用户',
        displayRealName: this.pickString(member.displayRealName, member.realName),
        stamp: this.pickString(member.stamp),
      }))
      .filter((member): member is YunxiaoProjectMember => Boolean(member.identifier));
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
