import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { UpdateYunxiaoIntegrationDto } from './dto/update-yunxiao-integration.dto';
import { UpdateYunxiaoMemberMappingDto } from './dto/update-yunxiao-member-mapping.dto';
import { BuiltInPluginRegistry } from './plugin.registry';

type IntegrationRequest = {
  authSession?: {
    user?: { id?: string };
    organization?: { id?: string } | null;
  };
};

@Controller('integrations')
export class PluginsController {
  constructor(private readonly registry: BuiltInPluginRegistry) {}

  @Get('yunxiao')
  getYunxiao(@Req() req: IntegrationRequest) {
    const organizationId = this.requireOrganizationId(req);
    return this.registry.get('yunxiao').getStatus(organizationId);
  }

  @Get('yunxiao/unmatched-recipients')
  getYunxiaoUnmatchedRecipients(@Req() req: IntegrationRequest) {
    const organizationId = this.requireOrganizationId(req);
    return this.registry.get('yunxiao').getUnmatchedRecipients(organizationId);
  }

  @Get('yunxiao/members')
  getYunxiaoProjectMembers(@Query('projectId') projectId: string, @Req() req: IntegrationRequest) {
    const organizationId = this.requireOrganizationId(req);
    return this.registry.get('yunxiao').getProjectMembers(organizationId, projectId ?? '');
  }

  @Patch('yunxiao/member-mapping')
  updateYunxiaoMemberMapping(
    @Body() dto: UpdateYunxiaoMemberMappingDto,
    @Req() req: IntegrationRequest,
  ) {
    const organizationId = this.requireOrganizationId(req);
    const userId = req.authSession?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user.');
    }
    return this.registry.get('yunxiao').setMemberMapping(
      organizationId,
      userId,
      {
        yunxiaoMemberId: dto.yunxiaoMemberId,
        yunxiaoUserId: dto.yunxiaoUserId,
        aliyunAccountId: dto.aliyunAccountId,
        yunxiaoUserIdentifier: dto.yunxiaoUserIdentifier,
        yunxiaoDisplayName: dto.yunxiaoDisplayName,
        flowxUserId: dto.flowxUserId ?? null,
      },
    );
  }

  @Patch('yunxiao')
  updateYunxiao(
    @Body() dto: UpdateYunxiaoIntegrationDto,
    @Req() req: IntegrationRequest,
  ) {
    const organizationId = this.requireOrganizationId(req);
    const userId = req.authSession?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user.');
    }
    const options = dto.yunxiaoOrganizationIdentifier === undefined
      ? undefined
      : { yunxiaoOrganizationIdentifier: dto.yunxiaoOrganizationIdentifier };
    return this.registry.get('yunxiao').updateStatus(organizationId, userId, dto.enabled, options);
  }

  private requireOrganizationId(req: IntegrationRequest) {
    const organizationId = req.authSession?.organization?.id?.trim();
    if (!organizationId) {
      throw new BadRequestException('请先加入或选择组织后再管理外部集成。');
    }
    return organizationId;
  }
}
