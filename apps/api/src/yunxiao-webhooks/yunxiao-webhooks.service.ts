import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DingTalkNotificationService } from '../notifications/dingtalk-notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  YunxiaoWebhookEventDto,
  YunxiaoWebhookRecipientDto,
} from './dto/yunxiao-webhook-event.dto';

type Member = {
  userId: string;
  user: {
    id: string;
    displayName: string;
    email: string | null;
    account: string | null;
    status: string;
    localCredential: { account: string } | null;
    identities: Array<{
      provider: string;
      providerUserId: string;
      providerUnionId: string | null;
      providerRawProfile: Prisma.JsonValue | null;
    }>;
  };
};

type MatchResult =
  | { kind: 'matched'; userId: string; matchedBy: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matchedBy: string };

@Injectable()
export class YunxiaoWebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dingTalkNotification: DingTalkNotificationService,
  ) {}

  async getOrCreateConfig(organizationId: string, actingUserId: string) {
    await this.requireOrganizationAdmin(organizationId, actingUserId);
    await this.requireDingTalkOrganization(organizationId);
    const config = await this.prisma.yunxiaoWebhookConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        webhookSecret: this.generateSecret(),
      },
      update: {},
    });
    return this.presentConfig(config);
  }

  async rotateSecret(organizationId: string, actingUserId: string) {
    await this.requireOrganizationAdmin(organizationId, actingUserId);
    await this.requireDingTalkOrganization(organizationId);
    const config = await this.prisma.yunxiaoWebhookConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        webhookSecret: this.generateSecret(),
      },
      update: {
        webhookSecret: this.generateSecret(),
      },
    });
    return this.presentConfig(config);
  }

  async listDeliveries(organizationId: string, actingUserId: string) {
    await this.requireOrganizationAdmin(organizationId, actingUserId);
    return this.prisma.yunxiaoWebhookDelivery.findMany({
      where: { organizationId },
      select: {
        id: true,
        eventId: true,
        status: true,
        recipient: true,
        matchedUserId: true,
        matchedBy: true,
        title: true,
        linkUrl: true,
        errorMessage: true,
        sentAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async receive(
    configId: string,
    suppliedSecret: string | undefined,
    input: YunxiaoWebhookEventDto,
  ) {
    const config = await this.prisma.yunxiaoWebhookConfig.findUnique({
      where: { id: configId },
    });
    if (
      !config ||
      !config.isActive ||
      !this.secretsEqual(config.webhookSecret, suppliedSecret)
    ) {
      throw new UnauthorizedException('Invalid Yunxiao webhook credentials.');
    }
    if (!input.recipient || !this.hasRecipientIdentifier(input.recipient)) {
      throw new BadRequestException('At least one recipient identifier is required.');
    }

    const claim = await this.claimDelivery(config, input);
    if (claim.duplicate) {
      return {
        accepted: true,
        duplicate: true,
        deliveryId: claim.deliveryId,
        status: claim.status,
      };
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: config.organizationId },
    });
    if (
      !organization ||
      organization.provider !== 'dingtalk' ||
      !organization.providerOrganizationId.trim()
    ) {
      await this.markFailed(claim.deliveryId, 'DingTalk organization is not configured.');
      throw new UnprocessableEntityException('DingTalk organization is not configured.');
    }

    const members = (await this.prisma.userOrganization.findMany({
      where: {
        organizationId: config.organizationId,
        user: { status: { not: 'DISABLED' } },
      },
      include: {
        user: {
          include: {
            localCredential: true,
            identities: {
              where: { provider: 'dingtalk' },
            },
          },
        },
      },
    })) as Member[];
    const match = this.matchRecipient(members, input.recipient);

    if (match.kind !== 'matched') {
      const ambiguous = match.kind === 'ambiguous';
      const message = ambiguous
        ? 'Recipient matched multiple organization members.'
        : 'No organization member matched the recipient.';
      await this.prisma.yunxiaoWebhookDelivery.update({
        where: { id: claim.deliveryId },
        data: {
          status: ambiguous ? 'AMBIGUOUS' : 'NO_MATCH',
          matchedBy: ambiguous ? match.matchedBy : null,
          errorMessage: message,
        },
      });
      throw new UnprocessableEntityException(message);
    }

    let providerResponse: unknown;
    try {
      providerResponse = await this.dingTalkNotification.sendPersonalMarkdown({
        flowxUserId: match.userId,
        corpId: organization.providerOrganizationId.trim(),
        title: input.title.trim(),
        markdown: this.buildMarkdown(input.markdown, input.url),
      });
    } catch {
      await this.markFailed(claim.deliveryId, 'DingTalk message delivery failed.');
      throw new BadGatewayException('DingTalk message delivery failed.');
    }

    await this.prisma.yunxiaoWebhookDelivery.update({
      where: { id: claim.deliveryId },
      data: {
        status: 'SENT',
        matchedUserId: match.userId,
        matchedBy: match.matchedBy,
        providerResponse: this.toJson(providerResponse),
        errorMessage: null,
        sentAt: new Date(),
      },
    });

    return {
      accepted: true,
      duplicate: false,
      deliveryId: claim.deliveryId,
      matchedBy: match.matchedBy,
    };
  }

  private async claimDelivery(
    config: { id: string; organizationId: string },
    input: YunxiaoWebhookEventDto,
  ): Promise<
    | { duplicate: false; deliveryId: string }
    | { duplicate: true; deliveryId: string; status: string }
  > {
    try {
      const delivery = await this.prisma.yunxiaoWebhookDelivery.create({
        data: {
          configId: config.id,
          organizationId: config.organizationId,
          eventId: input.eventId.trim(),
          status: 'PROCESSING',
          recipient: this.toJson(input.recipient),
          title: input.title.trim(),
          markdown: input.markdown.trim(),
          linkUrl: input.url?.trim() || null,
          rawPayload: this.toJson(input),
        },
      });
      return { duplicate: false, deliveryId: delivery.id };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    const existing = await this.prisma.yunxiaoWebhookDelivery.findUnique({
      where: {
        configId_eventId: {
          configId: config.id,
          eventId: input.eventId.trim(),
        },
      },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new BadGatewayException('Unable to resolve duplicate Yunxiao webhook event.');
    }

    if (['FAILED', 'NO_MATCH', 'AMBIGUOUS'].includes(existing.status)) {
      const reclaimed = await this.prisma.yunxiaoWebhookDelivery.updateMany({
        where: {
          id: existing.id,
          status: existing.status,
        },
        data: {
          status: 'PROCESSING',
          recipient: this.toJson(input.recipient),
          title: input.title.trim(),
          markdown: input.markdown.trim(),
          linkUrl: input.url?.trim() || null,
          rawPayload: this.toJson(input),
          matchedUserId: null,
          matchedBy: null,
          providerResponse: Prisma.JsonNull,
          errorMessage: null,
          sentAt: null,
        },
      });
      if (reclaimed.count === 1) {
        return { duplicate: false, deliveryId: existing.id };
      }
    }

    return {
      duplicate: true,
      deliveryId: existing.id,
      status: existing.status,
    };
  }

  private matchRecipient(members: Member[], recipient: YunxiaoWebhookRecipientDto): MatchResult {
    const matchers: Array<{
      key: keyof YunxiaoWebhookRecipientDto;
      matches: (member: Member, expected: string) => boolean;
    }> = [
      {
        key: 'dingtalkUserId',
        matches: (member, expected) =>
          member.user.identities.some((identity) => {
            const raw = this.asRecord(identity.providerRawProfile);
            const staffIds = [
              raw?.userid,
              raw?.userId,
              raw?.staffId,
              raw?.staffid,
              identity.providerUserId,
              identity.providerUserId.split(':').at(-1),
            ];
            return staffIds.some((value) => this.same(value, expected));
          }),
      },
      {
        key: 'unionId',
        matches: (member, expected) =>
          member.user.identities.some((identity) => {
            const raw = this.asRecord(identity.providerRawProfile);
            return [identity.providerUnionId, raw?.unionId, raw?.unionid].some((value) =>
              this.same(value, expected),
            );
          }),
      },
      {
        key: 'email',
        matches: (member, expected) => this.same(member.user.email, expected),
      },
      {
        key: 'account',
        matches: (member, expected) =>
          [member.user.localCredential?.account, member.user.account].some((value) =>
            this.same(value, expected),
          ),
      },
      {
        key: 'name',
        matches: (member, expected) => this.same(member.user.displayName, expected),
      },
    ];

    for (const matcher of matchers) {
      const expected = recipient[matcher.key]?.trim();
      if (!expected) {
        continue;
      }
      const matches = members.filter((member) => matcher.matches(member, expected));
      if (matches.length === 1) {
        return {
          kind: 'matched',
          userId: matches[0].userId,
          matchedBy: matcher.key,
        };
      }
      if (matches.length > 1) {
        return { kind: 'ambiguous', matchedBy: matcher.key };
      }
    }
    return { kind: 'none' };
  }

  private async requireOrganizationAdmin(organizationId: string, actingUserId: string) {
    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: actingUserId,
          organizationId,
        },
      },
      select: { role: true },
    });
    if (membership?.role !== 'admin') {
      throw new ForbiddenException('Organization admin access is required.');
    }
  }

  private async requireDingTalkOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { provider: true, providerOrganizationId: true },
    });
    if (organization?.provider !== 'dingtalk' || !organization.providerOrganizationId.trim()) {
      throw new BadRequestException('Current organization is not connected to DingTalk.');
    }
  }

  private presentConfig(config: {
    id: string;
    webhookSecret: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: config.id,
      webhookSecret: config.webhookSecret,
      isActive: config.isActive,
      endpointPath: `/yunxiao-webhooks/${config.id}/events`,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  private hasRecipientIdentifier(recipient: YunxiaoWebhookRecipientDto) {
    return [
      recipient.dingtalkUserId,
      recipient.unionId,
      recipient.email,
      recipient.account,
      recipient.name,
    ].some((value) => Boolean(value?.trim()));
  }

  private buildMarkdown(markdown: string, url?: string) {
    const content = markdown.trim();
    return url?.trim() ? `${content}\n\n[查看详情](${url.trim()})` : content;
  }

  private async markFailed(deliveryId: string, message: string) {
    await this.prisma.yunxiaoWebhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'FAILED',
        errorMessage: message,
      },
    });
  }

  private same(actual: unknown, expected: string) {
    return typeof actual === 'string' && actual.trim().toLocaleLowerCase() === expected.toLocaleLowerCase();
  }

  private secretsEqual(expected: string, supplied: string | undefined) {
    if (!supplied) {
      return false;
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied.trim());
    return (
      expectedBuffer.length === suppliedBuffer.length &&
      timingSafeEqual(expectedBuffer, suppliedBuffer)
    );
  }

  private generateSecret() {
    return randomBytes(32).toString('base64url');
  }

  private asRecord(value: unknown) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private toJson(value: unknown) {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? Prisma.JsonNull
      : (JSON.parse(serialized) as Prisma.InputJsonValue);
  }
}
