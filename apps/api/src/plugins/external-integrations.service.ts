import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { BuiltInPluginUpdateOptions } from './plugin.types';

const YUNXIAO_PROVIDER = 'YUNXIAO';

@Injectable()
export class ExternalIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
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
    if (!membership || membership.role !== 'admin') {
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

  async listYunxiaoUnmatchedRecipients(organizationId: string) {
    return this.prisma.yunxiaoWebhookRecipient.findMany({
      where: {
        organizationId,
        status: { not: 'MATCHED' },
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
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
    });
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

  private hasWebhookSecret() {
    return Boolean(this.configService.get<string>('YUNXIAO_WEBHOOK_SECRET')?.trim());
  }

  private hasYunxiaoOpenApiCredentials() {
    return Boolean(
      this.configService.get<string>('YUNXIAO_ACCESS_KEY_ID')?.trim()
      && this.configService.get<string>('YUNXIAO_ACCESS_KEY_SECRET')?.trim(),
    );
  }
}
