import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { DingTalkNotificationService } from '../notifications/dingtalk-notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  sendDingTalkMarkdown,
  sendEmail,
} from './delivery-senders';
import { formatBriefingTitle } from './briefing-renderer';
import { CreateDeliveryTargetDto } from './dto/create-delivery-target.dto';
import { UpdateDeliveryTargetDto } from './dto/update-delivery-target.dto';

export const BRIEFING_DELIVERY_SENDERS = Symbol('BRIEFING_DELIVERY_SENDERS');

export interface BriefingDeliverySenders {
  sendDingTalkMarkdown: typeof sendDingTalkMarkdown;
  sendEmail: typeof sendEmail;
}

type BriefingSendRecord = {
  id: string;
  projectId: string;
  projectName: string;
  date: Date;
  markdownContent: string;
  htmlContent: string;
};

@Injectable()
export class DeliveryTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(BRIEFING_DELIVERY_SENDERS)
    private readonly senders: BriefingDeliverySenders = {
      sendDingTalkMarkdown,
      sendEmail,
    },
    @Optional()
    private readonly authService?: AuthService,
    @Optional()
    private readonly dingTalkNotification?: DingTalkNotificationService,
  ) {}

  listTargets(params?: { workspaceId?: string; projectId?: string }) {
    const workspaceId = params?.workspaceId?.trim();
    const projectId = params?.projectId?.trim();
    return this.prisma.deliveryTarget.findMany({
      where: projectId
        ? { projectId }
        : workspaceId
          ? { project: { workspaceId } }
          : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTarget(dto: CreateDeliveryTargetDto, organizationId?: string) {
    const data = await this.toCreateData(dto, organizationId);
    return this.prisma.deliveryTarget.create({ data });
  }

  updateTarget(id: string, dto: UpdateDeliveryTargetDto) {
    return this.prisma.deliveryTarget.update({
      where: { id },
      data: {
        ...(dto.type === undefined ? {} : { type: dto.type.trim() }),
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.emailAddress === undefined
          ? {}
          : { emailAddress: dto.emailAddress.trim() || null }),
        ...(dto.dingtalkWebhookUrl === undefined
          ? {}
          : { dingtalkWebhookUrl: dto.dingtalkWebhookUrl.trim() || null }),
        ...(dto.dingtalkSecret === undefined
          ? {}
          : { dingtalkSecret: dto.dingtalkSecret.trim() || null }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });
  }

  deleteTarget(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.deliveryLog.deleteMany({ where: { deliveryTargetId: id } });
      return tx.deliveryTarget.delete({ where: { id } });
    });
  }

  async sendBriefing(briefing: BriefingSendRecord) {
    const targets = await this.prisma.deliveryTarget.findMany({
      where: {
        projectId: briefing.projectId,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    let successCount = 0;

    for (const target of targets) {
      try {
        const providerResponse = await this.sendToTarget(briefing, target);
        successCount += 1;
        await this.prisma.deliveryLog.create({
          data: {
            briefingId: briefing.id,
            deliveryTargetId: target.id,
            channel: target.type,
            status: 'SUCCESS',
            providerResponse: providerResponse as Prisma.InputJsonValue,
            sentAt: new Date(),
          },
        });
      } catch (error) {
        await this.prisma.deliveryLog.create({
          data: {
            briefingId: briefing.id,
            deliveryTargetId: target.id,
            channel: target.type,
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    if (successCount > 0) {
      await this.prisma.briefing.update({
        where: { id: briefing.id },
        data: { sentAt: new Date(), errorMessage: null },
      });
    } else if (targets.length === 0) {
      await this.prisma.briefing.update({
        where: { id: briefing.id },
        data: { errorMessage: '未配置启用的投递目标' },
      });
    } else {
      await this.prisma.briefing.update({
        where: { id: briefing.id },
        data: { errorMessage: '所有投递目标均失败，请查看投递记录' },
      });
    }

    return { successCount, targetCount: targets.length };
  }

  private async toCreateData(dto: CreateDeliveryTargetDto, organizationId?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId.trim() },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    let emailAddress = dto.emailAddress?.trim() || null;
    if (dto.type.trim() === 'EMAIL' && !emailAddress && dto.userId?.trim()) {
      if (!this.authService) {
        throw new BadRequestException('Email resolution is unavailable.');
      }
      if (!organizationId?.trim()) {
        throw new BadRequestException('Organization context is required to resolve member email.');
      }
      const resolved = await this.authService.resolveOrganizationMemberEmail(
        organizationId.trim(),
        dto.userId.trim(),
      );
      emailAddress = resolved.email;
    }
    if (dto.type.trim() === 'EMAIL' && !emailAddress) {
      throw new BadRequestException('Email address or organization member is required.');
    }

    const type = dto.type.trim();
    let userId = dto.userId?.trim() || null;
    let targetOrganizationId = organizationId?.trim() || null;
    if (type === 'DINGTALK_APP') {
      if (!userId) {
        throw new BadRequestException('Organization member is required for DingTalk app delivery.');
      }
      if (!targetOrganizationId) {
        throw new BadRequestException('Organization context is required for DingTalk app delivery.');
      }
      await this.assertOrganizationMember(targetOrganizationId, userId);
    } else {
      userId = null;
      targetOrganizationId = null;
    }

    return {
      projectId: project.id,
      type,
      name: dto.name.trim(),
      userId,
      organizationId: targetOrganizationId,
      emailAddress,
      dingtalkWebhookUrl: dto.dingtalkWebhookUrl?.trim() || null,
      dingtalkSecret: dto.dingtalkSecret?.trim() || null,
      isActive: dto.isActive ?? true,
    };
  }

  private async assertOrganizationMember(organizationId: string, userId: string) {
    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });
    if (!membership) {
      throw new BadRequestException('Organization member not found.');
    }
  }

  private async sendToTarget(
    briefing: BriefingSendRecord,
    target: {
      type: string;
      userId: string | null;
      organizationId: string | null;
      emailAddress: string | null;
      dingtalkWebhookUrl: string | null;
      dingtalkSecret: string | null;
    },
  ) {
    const subject = formatBriefingTitle(
      briefing.projectName,
      briefing.date.toISOString().slice(0, 10),
    );

    if (target.type === 'EMAIL') {
      if (!target.emailAddress) {
        throw new BadRequestException('Email address is required.');
      }
      return this.senders.sendEmail({
        smtp: {
          host: process.env.SMTP_HOST ?? '',
          port: Number(process.env.SMTP_PORT ?? 587),
          user: process.env.SMTP_USER ?? '',
          password: process.env.SMTP_PASSWORD ?? '',
          from: process.env.SMTP_FROM ?? 'flowx@example.com',
        },
        to: target.emailAddress,
        subject,
        html: briefing.htmlContent,
        text: briefing.markdownContent,
      });
    }

    if (target.type === 'DINGTALK_ROBOT') {
      if (!target.dingtalkWebhookUrl) {
        throw new BadRequestException('DingTalk webhook URL is required.');
      }
      return this.senders.sendDingTalkMarkdown({
        webhookUrl: target.dingtalkWebhookUrl,
        secret: target.dingtalkSecret ?? undefined,
        title: subject,
        markdown: briefing.markdownContent,
      });
    }

    if (target.type === 'DINGTALK_APP') {
      if (!target.userId || !target.organizationId) {
        throw new BadRequestException('DingTalk app delivery target is missing member binding.');
      }
      if (!this.dingTalkNotification) {
        throw new BadRequestException('DingTalk app delivery is unavailable.');
      }
      const organization = await this.prisma.organization.findUnique({
        where: { id: target.organizationId },
      });
      const corpId = organization?.providerOrganizationId?.trim();
      if (!corpId) {
        throw new BadRequestException('DingTalk organization is not configured.');
      }
      return this.dingTalkNotification.sendPersonalMarkdown({
        flowxUserId: target.userId,
        corpId,
        title: subject,
        markdown: briefing.markdownContent,
      });
    }

    throw new BadRequestException(`Unsupported delivery target type: ${target.type}`);
  }
}

