import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isOrganizationAdminRole } from '../auth/organization-role';
import { YunxiaoMembersService } from './yunxiao-members.service';
import type {
  BuiltInPluginUpdateOptions,
  YunxiaoMemberMappingInput,
} from './plugin.types';

const YUNXIAO_PROVIDER = 'YUNXIAO';

@Injectable()
export class ExternalIntegrationsService {
  private readonly logger = new Logger(ExternalIntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly yunxiaoMembers: YunxiaoMembersService,
  ) {}

  async getYunxiaoStatus(organizationId: string) {
    const integration = await this.prisma.externalIntegration.findFirst({
      where: { organizationId, provider: YUNXIAO_PROVIDER },
    });
    return this.toStatus(
      integration?.enabled ?? this.hasWebhookSecret(),
      integration?.yunxiaoOrganizationIdentifier ?? null,
    );
  }

  async updateYunxiaoStatus(
    organizationId: string,
    actingUserId: string,
    enabled: boolean,
    options?: BuiltInPluginUpdateOptions,
  ) {
    if (enabled && !this.hasWebhookSecret()) {
      throw new BadRequestException(
        'Yunxiao integration requires YUNXIAO_WEBHOOK_SECRET before it can be enabled.',
      );
    }
    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: actingUserId,
          organizationId,
        },
      },
    });
    if (!membership || !isOrganizationAdminRole(membership.role)) {
      throw new ForbiddenException('Organization admin permission required.');
    }

    const current = await this.prisma.externalIntegration.findFirst({
      where: { organizationId, provider: YUNXIAO_PROVIDER },
    });
    const shouldUpdateBinding = options !== undefined;
    const yunxiaoOrganizationIdentifier = shouldUpdateBinding
      ? this.normalizeOrganizationIdentifier(options.yunxiaoOrganizationIdentifier)
      : current?.yunxiaoOrganizationIdentifier ?? null;
    if (enabled && !yunxiaoOrganizationIdentifier) {
      throw new BadRequestException(
        'Yunxiao integration requires a Yunxiao organization identifier before it can be enabled.',
      );
    }

    const bindingData = shouldUpdateBinding
      ? { yunxiaoOrganizationIdentifier }
      : {};
    let integration;
    try {
      integration = current
        ? await this.prisma.externalIntegration.update({
            where: { id: current.id },
            data: { enabled, ...bindingData },
          })
        : await this.prisma.externalIntegration.create({
            data: {
              organizationId,
              provider: YUNXIAO_PROVIDER,
              enabled,
              ...bindingData,
            },
          });
    } catch (error) {
      if (
        shouldUpdateBinding
        && yunxiaoOrganizationIdentifier
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This Yunxiao organization is already bound to another FlowX organization.',
        );
      }
      throw error;
    }

    return this.toStatus(integration.enabled, integration.yunxiaoOrganizationIdentifier);
  }

  async isYunxiaoEnabled(organizationId: string) {
    const integration = await this.prisma.externalIntegration.findFirst({
      where: { organizationId, provider: YUNXIAO_PROVIDER },
    });
    return integration?.enabled ?? this.hasWebhookSecret();
  }

  async listYunxiaoUnmatchedRecipients(organizationId: string, query: PaginationQuery & { q?: string } = {}) {
    const paging = parsePagination(query);
    const where = { organizationId, status: { not: 'MATCHED' }, ...(query.q?.trim() ? { OR: [{ yunxiaoDisplayName: { contains: query.q.trim() } }, { yunxiaoUserIdentifier: { contains: query.q.trim() } }, { workItemId: { contains: query.q.trim() } }] } : {}) };
    const [items, total] = await Promise.all([
 this.prisma.yunxiaoWebhookRecipient.findMany({
      where,
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      skip: paging.skip,
      take: paging.take,
      select: {
        id: true,
        eventId: true,
        workItemId: true,
        projectId: true,
        yunxiaoUserIdentifier: true,
        yunxiaoDisplayName: true,
        roles: true,
        status: true,
        reason: true,
        dingTalkId: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    }),
      this.prisma.yunxiaoWebhookRecipient.count({ where }),
    ]);
    return pageResult(items, total, paging);
  }

  async clearYunxiaoUnmatchedRecipients(organizationId: string, actingUserId: string) {
    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: actingUserId,
          organizationId,
        },
      },
    });
    if (!membership || !isOrganizationAdminRole(membership.role)) {
      throw new ForbiddenException('Organization admin permission required.');
    }

    const result = await this.prisma.yunxiaoWebhookRecipient.deleteMany({
      where: {
        organizationId,
        status: { not: 'MATCHED' },
      },
    });
    this.logger.log(JSON.stringify({
      event: 'YUNXIAO_UNMATCHED_RECIPIENTS_CLEARED',
      organizationId,
      actingUserId,
      deletedCount: result.count,
    }));
    return { deletedCount: result.count };
  }

  async listYunxiaoProjectMembers(organizationId: string, projectId: string, query: { userId?: string } = {}) {
    const userId = query.userId?.trim();
    if (!userId) throw new BadRequestException({ code: 'YUNXIAO_MEMBER_BROWSE_UNSUPPORTED', message: '云效项目成员接口不支持服务端分页。请输入明确的云效 userId 按需查询组织身份；此查询不证明其项目成员资格。' });
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) throw new BadRequestException('Yunxiao project identifier is required.');
    const integration = await this.prisma.externalIntegration.findFirst({ where: { organizationId, provider: YUNXIAO_PROVIDER }, select: { yunxiaoOrganizationIdentifier: true } });
    const yunxiaoOrganizationIdentifier = integration?.yunxiaoOrganizationIdentifier;
    if (!yunxiaoOrganizationIdentifier) throw new BadRequestException('Please bind a Yunxiao organization before querying members.');
    const member = await this.yunxiaoMembers.getOrganizationMember(yunxiaoOrganizationIdentifier, userId);
    const identifiers = [member.aliyunAccountId, member.userId, member.memberId].filter((id): id is string => Boolean(id));
    const mappings = await this.prisma.yunxiaoMemberMapping.findMany({ where: { organizationId, yunxiaoOrganizationIdentifier, OR: [
      { aliyunAccountId: { in: identifiers } }, { yunxiaoUserId: { in: identifiers } },
      { yunxiaoMemberId: { in: identifiers } }, { yunxiaoUserIdentifier: { in: identifiers } },
    ] }, select: { flowxUserId: true }, take: 1, orderBy: { id: 'asc' } });
    return { projectId: normalizedProjectId, yunxiaoOrganizationIdentifier, identityScope: 'organization' as const, members: [{ ...member, flowxUserId: mappings[0]?.flowxUserId ?? null }] };
  }

  async setYunxiaoMemberMapping(
    organizationId: string,
    actingUserId: string,
    input: YunxiaoMemberMappingInput,
  ) {
    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: actingUserId,
          organizationId,
        },
      },
    });
    if (!membership || !isOrganizationAdminRole(membership.role)) {
      throw new ForbiddenException('Organization admin permission required.');
    }

    const integration = await this.prisma.externalIntegration.findFirst({
      where: { organizationId, provider: YUNXIAO_PROVIDER },
      select: { yunxiaoOrganizationIdentifier: true },
    });
    const yunxiaoOrganizationIdentifier = integration?.yunxiaoOrganizationIdentifier;
    if (!yunxiaoOrganizationIdentifier) {
      throw new BadRequestException(
        'Please bind a Yunxiao organization before saving member mappings.',
      );
    }

    const yunxiaoMemberId = this.normalizeIdentifier(input.yunxiaoMemberId);
    const yunxiaoUserId = this.normalizeIdentifier(input.yunxiaoUserId);
    const aliyunAccountId = this.normalizeIdentifier(input.aliyunAccountId);
    const legacyYunxiaoUserIdentifier = this.normalizeIdentifier(input.yunxiaoUserIdentifier);
    const normalizedYunxiaoUserIdentifier =
      aliyunAccountId ?? yunxiaoUserId ?? yunxiaoMemberId ?? legacyYunxiaoUserIdentifier;
    if (!normalizedYunxiaoUserIdentifier) {
      throw new BadRequestException('At least one Yunxiao member identifier is required.');
    }
    const identityWhere: Prisma.YunxiaoMemberMappingWhereInput = {
      organizationId,
      yunxiaoOrganizationIdentifier,
      OR: [
        ...(yunxiaoMemberId ? [{ yunxiaoMemberId }] : []),
        ...(yunxiaoUserId ? [{ yunxiaoUserId }] : []),
        ...(aliyunAccountId ? [{ aliyunAccountId }] : []),
        ...(legacyYunxiaoUserIdentifier
          ? [{ yunxiaoUserIdentifier: legacyYunxiaoUserIdentifier }]
          : []),
      ],
    };
    const mappingUnique = {
      organizationId_yunxiaoOrganizationIdentifier_yunxiaoUserIdentifier: {
        organizationId,
        yunxiaoOrganizationIdentifier,
        yunxiaoUserIdentifier: normalizedYunxiaoUserIdentifier,
      },
    };
    if (!input.flowxUserId) {
      await this.prisma.yunxiaoMemberMapping.deleteMany({ where: identityWhere });
      this.logger.log(JSON.stringify({
        event: 'YUNXIAO_MEMBER_MAPPING_REMOVED',
        organizationId,
        actingUserId,
        yunxiaoOrganizationIdentifier,
        yunxiaoMemberId,
        yunxiaoUserId,
        aliyunAccountId,
      }));
      return { mapped: false };
    }

    const flowxMembership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: { userId: input.flowxUserId, organizationId },
      },
      include: {
        user: { select: { id: true, displayName: true, account: true, email: true, status: true } },
      },
    });
    if (!flowxMembership || flowxMembership.user.status === 'DISABLED') {
      throw new BadRequestException('FlowX user must be an active member of the organization.');
    }

    // 同一云效人员可能已经有旧版本的映射，先按三种身份合并，避免留下旧 ID 记录。
    await this.prisma.yunxiaoMemberMapping.deleteMany({ where: identityWhere });
    const mapping = await this.prisma.yunxiaoMemberMapping.upsert({
      where: mappingUnique,
      create: {
        organizationId,
        yunxiaoOrganizationIdentifier,
        yunxiaoUserIdentifier: normalizedYunxiaoUserIdentifier,
        yunxiaoMemberId,
        yunxiaoUserId,
        aliyunAccountId,
        yunxiaoDisplayName: input.yunxiaoDisplayName?.trim() || '未知云效用户',
        flowxUserId: input.flowxUserId,
      },
      update: {
        yunxiaoMemberId,
        yunxiaoUserId,
        aliyunAccountId,
        yunxiaoDisplayName: input.yunxiaoDisplayName?.trim() || '未知云效用户',
        flowxUserId: input.flowxUserId,
      },
      select: {
        yunxiaoMemberId: true,
        yunxiaoUserId: true,
        aliyunAccountId: true,
        yunxiaoUserIdentifier: true,
        yunxiaoDisplayName: true,
        flowxUserId: true,
      },
    });
    this.logger.log(JSON.stringify({
      event: 'YUNXIAO_MEMBER_MAPPING_SAVED',
      organizationId,
      actingUserId,
      yunxiaoOrganizationIdentifier,
      yunxiaoMemberId,
      yunxiaoUserId,
      aliyunAccountId,
      yunxiaoUserIdentifier: normalizedYunxiaoUserIdentifier,
      yunxiaoDisplayName: input.yunxiaoDisplayName?.trim() || '未知云效用户',
      flowxUserId: input.flowxUserId,
    }));
    return mapping;
  }

  private toStatus(enabled: boolean, yunxiaoOrganizationIdentifier: string | null) {
    const configured = this.hasWebhookSecret();
    return {
      provider: YUNXIAO_PROVIDER,
      enabled,
      configured,
      openApiConfigured: this.hasYunxiaoOpenApiCredentials(),
      webhookPath: '/api/yunxiao-webhooks',
      yunxiaoOrganizationIdentifier,
    };
  }

  private normalizeOrganizationIdentifier(value: string | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }
    const normalized = value.trim();
    return normalized || null;
  }

  private normalizeIdentifier(value: string | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }
    const normalized = value.trim();
    return normalized || null;
  }

  private hasWebhookSecret() {
    return Boolean(this.configService.get<string>('YUNXIAO_WEBHOOK_SECRET')?.trim());
  }

  private hasYunxiaoOpenApiCredentials() {
    return Boolean(
      this.configService.get<string>('YUNXIAO_PERSONAL_ACCESS_TOKEN')?.trim()
      || (
        this.configService.get<string>('YUNXIAO_ACCESS_KEY_ID')?.trim()
        && this.configService.get<string>('YUNXIAO_ACCESS_KEY_SECRET')?.trim()
      ),
    );
  }
}
