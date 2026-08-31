import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DingTalkNotificationService } from '../notifications/dingtalk-notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { YunxiaoPlugin } from '../plugins/yunxiao.plugin';

type YunxiaoPerson = {
  id: string | null;
  name: string;
};

type NormalizedWorkItem = {
  id: string;
  yunxiaoOrganizationIdentifier: string;
  eventId: string;
  serialNumber: string | null;
  subject: string;
  assignedTo: YunxiaoPerson;
  statusName: string | null;
  spaceName: string | null;
  url: string | null;
};

type Member = {
  userId: string;
  organizationId: string;
  user: {
    id: string;
    displayName: string;
    account: string | null;
    email: string | null;
    status: string;
    localCredential: { account: string } | null;
  };
  organization: {
    id: string;
    provider: string;
    providerOrganizationId: string;
  };
};

type MatchedMember = {
  userId: string;
  organizationId: string;
  corpId: string;
  matchedBy: 'assignedTo.id' | 'assignedTo.name';
};

@Injectable()
export class YunxiaoWebhooksService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly dingTalkNotification: DingTalkNotificationService,
    private readonly yunxiaoPlugin: YunxiaoPlugin,
  ) {}

  async receive(signature: string | undefined, payload: Record<string, unknown>) {
    this.verifySignature(signature);
    const workItem = this.normalizeWorkItem(payload);
    const matched = await this.resolveRecipient(
      workItem.assignedTo,
      workItem.yunxiaoOrganizationIdentifier,
    );
    if (!(await this.yunxiaoPlugin.isEnabled(matched.organizationId))) {
      return {
        accepted: true,
        disabled: true,
      };
    }
    const markdown = this.buildMarkdown(workItem);
    const claim = await this.claimDelivery(matched, workItem, payload, markdown);
    if (claim.duplicate) {
      return {
        accepted: true,
        duplicate: true,
        deliveryId: claim.deliveryId,
        status: claim.status,
      };
    }

    let providerResponse: unknown;
    try {
      providerResponse = await this.dingTalkNotification.sendPersonalMarkdown({
        flowxUserId: matched.userId,
        corpId: matched.corpId,
        title: `云效工作项：${workItem.subject}`,
        markdown,
      });
    } catch {
      await this.markFailed(claim.deliveryId, 'DingTalk message delivery failed.');
      throw new BadGatewayException('DingTalk message delivery failed.');
    }

    await this.prisma.yunxiaoWebhookDelivery.update({
      where: { id: claim.deliveryId },
      data: {
        status: 'SENT',
        providerResponse: this.toJson(providerResponse),
        errorMessage: null,
        sentAt: new Date(),
      },
    });

    return {
      accepted: true,
      duplicate: false,
      deliveryId: claim.deliveryId,
      matchedBy: matched.matchedBy,
    };
  }

  private verifySignature(signature: string | undefined) {
    const secret = this.configService.get<string>('YUNXIAO_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException('Yunxiao webhook secret is not configured.');
    }
    if (!signature || !this.secretsEqual(secret, signature.trim())) {
      throw new UnauthorizedException('Invalid Yunxiao webhook signature.');
    }
  }

  private normalizeWorkItem(payload: Record<string, unknown>): NormalizedWorkItem {
    const yunxiaoOrganizationIdentifier = this.pickString(payload.organizationIdentifier);
    if (!yunxiaoOrganizationIdentifier) {
      throw new BadRequestException('Yunxiao organization identifier is required.');
    }

    const assignedTo = this.asRecord(payload.assignedTo);
    const assignedToName = this.pickString(
      assignedTo?.name,
      assignedTo?.realName,
      assignedTo?.displayName,
      assignedTo?.nickName,
    );
    if (!assignedToName) {
      throw new BadRequestException('Yunxiao work item assignee is required.');
    }

    const id = this.pickString(payload.workItemIdentifier, payload.id, payload.identifier);
    const subject = this.pickString(payload.subject);
    if (!id || !subject) {
      throw new BadRequestException('Yunxiao work item id and subject are required.');
    }

    const modifiedAt = this.pickStringOrNumber(payload.gmtModified, payload.updateStatusAt);
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(payload), 'utf8')
      .digest('hex')
      .slice(0, 24);
    const status = this.asRecord(payload.status);
    const space = this.asRecord(payload.space);

    return {
      id,
      yunxiaoOrganizationIdentifier,
      eventId: `${id}:${modifiedAt ?? payloadHash}`,
      serialNumber: this.pickStringOrNumber(payload.serialNumber),
      subject,
      assignedTo: {
        id: this.pickString(assignedTo?.id, assignedTo?.identifier),
        name: assignedToName,
      },
      statusName: this.pickString(status?.displayName, status?.name),
      spaceName: this.pickString(space?.name),
      url: this.resolveWorkItemUrl(payload, id),
    };
  }

  private resolveWorkItemUrl(payload: Record<string, unknown>, workItemId: string) {
    const candidateUrl = this.pickString(payload.url, payload.webUrl);
    if (candidateUrl && /^https?:\/\//i.test(candidateUrl)) {
      return candidateUrl;
    }

    const space = this.asRecord(payload.space);
    const workitemType = this.asRecord(payload.workitemType);
    const projectId = this.pickString(
      payload.projectId,
      payload.spaceIdentifier,
      space?.identifier,
      space?.id,
    );
    const categoryId = this.pickString(
      payload.categoryId,
      payload.category,
      workitemType?.categoryIdentifier,
      workitemType?.nameEn,
    )?.toLocaleLowerCase();
    if (!projectId || !categoryId) {
      return null;
    }

    const fragment = new URLSearchParams();
    const explicitWorkItemId = this.pickString(payload.workItemIdentifier);
    const viewIdentifier = this.pickString(
      payload.viewIdentifier,
      explicitWorkItemId ? payload.identifier : null,
    );
    if (viewIdentifier) {
      fragment.set('viewIdentifier', viewIdentifier);
    }
    fragment.set('openWorkitemIdentifier', explicitWorkItemId ?? workItemId);

    return [
      'https://devops.aliyun.com/projex/project',
      encodeURIComponent(projectId),
      encodeURIComponent(categoryId),
    ].join('/') + `#${fragment.toString()}`;
  }

  private async resolveRecipient(
    assignedTo: YunxiaoPerson,
    yunxiaoOrganizationIdentifier: string,
  ): Promise<MatchedMember> {
    const integration = await this.prisma.externalIntegration.findFirst({
      where: {
        provider: 'YUNXIAO',
        yunxiaoOrganizationIdentifier,
      },
      select: { organizationId: true },
    });
    if (!integration) {
      throw new UnprocessableEntityException(
        'No FlowX organization is mapped to the Yunxiao organization.',
      );
    }

    const memberships = (await this.prisma.userOrganization.findMany({
      where: {
        organizationId: integration.organizationId,
        user: { status: { not: 'DISABLED' } },
        organization: { provider: 'dingtalk' },
      },
      include: {
        user: { include: { localCredential: true } },
        organization: true,
      },
    })) as Member[];

    if (assignedTo.id) {
      const idMatches = memberships.filter((membership) =>
        [membership.user.account, membership.user.localCredential?.account].some((value) =>
          this.same(value, assignedTo.id as string),
        ),
      );
      if (idMatches.length === 1) {
        return this.toMatchedMember(idMatches[0], 'assignedTo.id');
      }
      if (idMatches.length > 1) {
        throw new UnprocessableEntityException(
          'Yunxiao assignee matched multiple FlowX organization members.',
        );
      }
    }

    const nameMatches = memberships.filter((membership) =>
      this.same(membership.user.displayName, assignedTo.name),
    );
    if (nameMatches.length === 1) {
      return this.toMatchedMember(nameMatches[0], 'assignedTo.name');
    }
    if (nameMatches.length > 1) {
      throw new UnprocessableEntityException(
        'Yunxiao assignee matched multiple FlowX organization members.',
      );
    }
    throw new UnprocessableEntityException(
      'No FlowX organization member matched the Yunxiao assignee.',
    );
  }

  private toMatchedMember(
    membership: Member,
    matchedBy: MatchedMember['matchedBy'],
  ): MatchedMember {
    return {
      userId: membership.userId,
      organizationId: membership.organizationId,
      corpId: membership.organization.providerOrganizationId,
      matchedBy,
    };
  }

  private async claimDelivery(
    matched: MatchedMember,
    workItem: NormalizedWorkItem,
    payload: Record<string, unknown>,
    markdown: string,
  ): Promise<
    | { duplicate: false; deliveryId: string }
    | { duplicate: true; deliveryId: string; status: string }
  > {
    try {
      const delivery = await this.prisma.yunxiaoWebhookDelivery.create({
        data: {
          organizationId: matched.organizationId,
          eventId: workItem.eventId,
          status: 'PROCESSING',
          recipient: this.toJson(workItem.assignedTo),
          matchedUserId: matched.userId,
          matchedBy: matched.matchedBy,
          title: `云效工作项：${workItem.subject}`,
          markdown,
          linkUrl: workItem.url,
          rawPayload: this.toJson(payload),
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
        organizationId_eventId: {
          organizationId: matched.organizationId,
          eventId: workItem.eventId,
        },
      },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new BadGatewayException('Unable to resolve duplicate Yunxiao webhook event.');
    }

    if (existing.status === 'FAILED') {
      const reclaimed = await this.prisma.yunxiaoWebhookDelivery.updateMany({
        where: { id: existing.id, status: 'FAILED' },
        data: {
          status: 'PROCESSING',
          recipient: this.toJson(workItem.assignedTo),
          matchedUserId: matched.userId,
          matchedBy: matched.matchedBy,
          title: `云效工作项：${workItem.subject}`,
          markdown,
          linkUrl: workItem.url,
          rawPayload: this.toJson(payload),
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

  private buildMarkdown(workItem: NormalizedWorkItem) {
    const lines = [`## ${workItem.subject}`, ''];
    if (workItem.serialNumber) {
      lines.push(`- 编号：${workItem.serialNumber}`);
    }
    if (workItem.spaceName) {
      lines.push(`- 项目：${workItem.spaceName}`);
    }
    if (workItem.statusName) {
      lines.push(`- 状态：${workItem.statusName}`);
    }
    lines.push(`- 负责人：${workItem.assignedTo.name}`);
    if (workItem.url) {
      lines.push('', `[查看工作项](${workItem.url})`);
    }
    return lines.join('\n');
  }

  private async markFailed(deliveryId: string, message: string) {
    await this.prisma.yunxiaoWebhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'FAILED', errorMessage: message },
    });
  }

  private secretsEqual(expected: string, actual: string) {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length
      && timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private same(actual: unknown, expected: string) {
    return typeof actual === 'string'
      && actual.trim().toLocaleLowerCase() === expected.trim().toLocaleLowerCase();
  }

  private pickString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private pickStringOrNumber(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
    return null;
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
