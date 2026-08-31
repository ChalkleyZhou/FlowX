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
  roles: YunxiaoRecipientRole[];
};

type YunxiaoRecipientRole = 'assignedTo' | 'participant' | 'verifier' | 'creator';

type NormalizedWorkItem = {
  id: string;
  yunxiaoOrganizationIdentifier: string;
  eventId: string;
  serialNumber: string | null;
  subject: string;
  assignedTo: YunxiaoPerson | null;
  recipients: YunxiaoPerson[];
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
  matchedBy: `${YunxiaoRecipientRole}.id` | `${YunxiaoRecipientRole}.name`;
  recipient: YunxiaoPerson;
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
    const resolved = await this.resolveRecipients(
      workItem.recipients,
      workItem.yunxiaoOrganizationIdentifier,
    );
    if (!(await this.yunxiaoPlugin.isEnabled(resolved.organizationId))) {
      return {
        accepted: true,
        disabled: true,
      };
    }
    const markdown = this.buildMarkdown(workItem);
    const deliveryIds: string[] = [];
    let sentCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    for (const matched of resolved.recipients) {
      const claim = await this.claimDelivery(matched, workItem, payload, markdown);
      deliveryIds.push(claim.deliveryId);
      if (claim.duplicate) {
        duplicateCount += 1;
        continue;
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
        failedCount += 1;
        await this.markFailed(claim.deliveryId, 'DingTalk message delivery failed.');
        continue;
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
      sentCount += 1;
    }

    if (failedCount > 0) {
      throw new BadGatewayException({
        message: 'One or more DingTalk message deliveries failed.',
        recipientCount: resolved.recipients.length,
        sentCount,
        duplicateCount,
        failedCount,
        unmatchedCount: resolved.unmatchedCount,
      });
    }

    return {
      accepted: true,
      duplicate: sentCount === 0,
      deliveryIds,
      recipientCount: resolved.recipients.length,
      sentCount,
      duplicateCount,
      unmatchedCount: resolved.unmatchedCount,
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

    const assignedTo = this.parsePerson(payload.assignedTo, 'assignedTo');
    const recipients = [
      ...(assignedTo ? [assignedTo] : []),
      ...this.parsePeople(
        this.firstDefined(payload.participants, payload.participantList, payload.participant),
        'participant',
      ),
      ...this.parsePeople(
        this.firstDefined(
          payload.verifiers,
          payload.verifier,
          payload.verifyUsers,
          payload.verifyUser,
          payload.validators,
          payload.validator,
        ),
        'verifier',
      ),
      ...this.parsePeople(payload.creator, 'creator'),
    ];
    if (recipients.length === 0) {
      throw new BadRequestException('Yunxiao work item notification recipients are required.');
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
      assignedTo,
      recipients,
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

  private async resolveRecipients(
    recipients: YunxiaoPerson[],
    yunxiaoOrganizationIdentifier: string,
  ) {
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

    const matchedByUserId = new Map<string, MatchedMember>();
    let unmatchedCount = 0;
    for (const recipient of recipients) {
      const matched = this.matchRecipient(memberships, recipient);
      if (!matched) {
        unmatchedCount += 1;
        continue;
      }
      const existing = matchedByUserId.get(matched.userId);
      if (existing) {
        for (const role of matched.recipient.roles) {
          if (!existing.recipient.roles.includes(role)) {
            existing.recipient.roles.push(role);
          }
        }
        continue;
      }
      matchedByUserId.set(matched.userId, matched);
    }

    const matchedRecipients = [...matchedByUserId.values()];
    if (matchedRecipients.length === 0) {
      throw new UnprocessableEntityException(
        'No FlowX organization member matched the Yunxiao notification recipients.',
      );
    }
    return {
      organizationId: integration.organizationId,
      recipients: matchedRecipients,
      unmatchedCount,
    };
  }

  private matchRecipient(memberships: Member[], recipient: YunxiaoPerson) {
    const role = recipient.roles[0];
    if (recipient.id) {
      const idMatches = memberships.filter((membership) =>
        [membership.user.account, membership.user.localCredential?.account].some((value) =>
          this.same(value, recipient.id as string),
        ),
      );
      if (idMatches.length === 1) {
        return this.toMatchedMember(idMatches[0], recipient, `${role}.id`);
      }
      if (idMatches.length > 1) {
        throw new UnprocessableEntityException(
          'A Yunxiao notification recipient matched multiple FlowX organization members.',
        );
      }
    }

    const nameMatches = memberships.filter((membership) =>
      this.same(membership.user.displayName, recipient.name),
    );
    if (nameMatches.length === 1) {
      return this.toMatchedMember(nameMatches[0], recipient, `${role}.name`);
    }
    if (nameMatches.length > 1) {
      throw new UnprocessableEntityException(
        'A Yunxiao notification recipient matched multiple FlowX organization members.',
      );
    }
    return null;
  }

  private toMatchedMember(
    membership: Member,
    recipient: YunxiaoPerson,
    matchedBy: MatchedMember['matchedBy'],
  ): MatchedMember {
    return {
      userId: membership.userId,
      organizationId: membership.organizationId,
      corpId: membership.organization.providerOrganizationId,
      matchedBy,
      recipient: { ...recipient, roles: [...recipient.roles] },
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
          recipient: this.toJson(matched.recipient),
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
        organizationId_eventId_matchedUserId: {
          organizationId: matched.organizationId,
          eventId: workItem.eventId,
          matchedUserId: matched.userId,
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
          recipient: this.toJson(matched.recipient),
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
    if (workItem.assignedTo) {
      lines.push(`- 负责人：${workItem.assignedTo.name}`);
    }
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

  private parsePeople(value: unknown, role: YunxiaoRecipientRole): YunxiaoPerson[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.parsePerson(item, role))
        .filter((person): person is YunxiaoPerson => person !== null);
    }
    const record = this.asRecord(value);
    if (Array.isArray(record?.valueList)) {
      return this.parsePeople(record.valueList, role);
    }
    const person = this.parsePerson(value, role);
    return person ? [person] : [];
  }

  private parsePerson(value: unknown, role: YunxiaoRecipientRole): YunxiaoPerson | null {
    const person = this.asRecord(value);
    if (!person) {
      return null;
    }
    const id = this.pickString(person.id, person.identifier, person.userId);
    const name = this.pickString(
      person.name,
      person.realName,
      person.displayName,
      person.nickName,
      person.displayValue,
    );
    if (!id && !name) {
      return null;
    }
    return {
      id,
      name: (name ?? id) as string,
      roles: [role],
    };
  }

  private firstDefined(...values: unknown[]) {
    return values.find((value) => value !== undefined && value !== null);
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
