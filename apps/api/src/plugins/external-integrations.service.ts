import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

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
    return this.toStatus(integration?.enabled ?? this.hasWebhookSecret());
  }

  async updateYunxiaoStatus(
    organizationId: string,
    actingUserId: string,
    enabled: boolean,
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
    const integration = current
      ? await this.prisma.externalIntegration.update({
          where: { id: current.id },
          data: { enabled },
        })
      : await this.prisma.externalIntegration.create({
          data: {
            organizationId,
            provider: YUNXIAO_PROVIDER,
            enabled,
          },
        });

    return this.toStatus(integration.enabled);
  }

  async isYunxiaoEnabled(organizationId: string) {
    const integration = await this.prisma.externalIntegration.findFirst({
      where: { organizationId, provider: YUNXIAO_PROVIDER },
    });
    return integration?.enabled ?? this.hasWebhookSecret();
  }

  private toStatus(enabled: boolean) {
    const configured = this.hasWebhookSecret();
    return {
      provider: YUNXIAO_PROVIDER,
      enabled,
      configured,
      webhookPath: '/api/yunxiao-webhooks',
    };
  }

  private hasWebhookSecret() {
    return Boolean(this.configService.get<string>('YUNXIAO_WEBHOOK_SECRET')?.trim());
  }
}
