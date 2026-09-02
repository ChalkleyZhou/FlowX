import {
  BadGatewayException,
  BadRequestException,
  Logger,
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
import { YunxiaoMembersService, type YunxiaoProjectMember } from '../plugins/yunxiao-members.service';
import { YunxiaoPlugin } from '../plugins/yunxiao.plugin';

type YunxiaoPerson = {
  id: string | null;
  name: string;
  roles: YunxiaoRecipientRole[];
};

type RecipientAudit = {
  recipient: YunxiaoPerson;
  status: 'MATCHED' | 'UNMATCHED';
  reason: string | null;
  dingTalkId: string | null;
  matchedUserId: string | null;
};

type YunxiaoRecipientRole = 'assignedTo' | 'participant' | 'verifier' | 'creator';

type NormalizedWorkItem = {
  id: string;
  yunxiaoOrganizationIdentifier: string;
  eventId: string;
  serialNumber: string | null;
  subject: string;
  projectId: string | null;
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
    identities: Array<{
      providerUserId: string;
      providerUnionId: string | null;
      providerRawProfile: unknown;
    }>;
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
  matchedBy: `${YunxiaoRecipientRole}.id`;
  recipient: YunxiaoPerson;
};

@Injectable()
export class YunxiaoWebhooksService {
  private readonly logger = new Logger(YunxiaoWebhooksService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly dingTalkNotification: DingTalkNotificationService,
    private readonly yunxiaoPlugin: YunxiaoPlugin,
    private readonly yunxiaoMembers: YunxiaoMembersService,
  ) {}

  async receive(signature: string | undefined, payload: Record<string, unknown>) {
    this.logger.log(JSON.stringify({
      event: 'YUNXIAO_WEBHOOK_REQUEST',
      signaturePresent: Boolean(signature?.trim()),
      payloadKeys: Object.keys(payload).sort(),
    }));
    this.verifySignature(signature);
    const workItem = this.normalizeWorkItem(payload);
    this.logger.log(JSON.stringify({
      event: 'YUNXIAO_WEBHOOK_RECEIVED',
      organizationIdentifier: workItem.yunxiaoOrganizationIdentifier,
      workItemId: workItem.id,
      projectId: workItem.projectId,
      payloadKeys: Object.keys(payload).sort(),
      recipients: workItem.recipients.map((recipient) => ({
        id: recipient.id,
        name: recipient.name,
        roles: recipient.roles,
      })),
    }));
    const organizationId = await this.findBoundOrganizationId(
      workItem.yunxiaoOrganizationIdentifier,
    );
    if (!(await this.yunxiaoPlugin.isEnabled(organizationId))) {
      return {
        accepted: true,
        disabled: true,
      };
    }
    const resolved = await this.resolveRecipients(
      workItem.recipients,
      workItem.yunxiaoOrganizationIdentifier,
      workItem.projectId,
      organizationId,
    );
    await this.recordRecipientAudits(resolved.audits, resolved.organizationId, workItem);
    if (resolved.openApiError) {
      throw new BadGatewayException(resolved.openApiError);
    }
    if (resolved.recipients.length === 0) {
      throw new UnprocessableEntityException(
        'No FlowX organization member matched the Yunxiao notification recipients.',
      );
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
    const projectId = this.pickString(
      payload.projectId,
      payload.spaceIdentifier,
      space?.identifier,
      space?.id,
    );

    return {
      id,
      yunxiaoOrganizationIdentifier,
      eventId: `${id}:${modifiedAt ?? payloadHash}`,
      serialNumber: this.pickStringOrNumber(payload.serialNumber),
      subject,
      projectId,
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
    projectId: string | null,
    organizationId: string,
  ) {
    const memberships = (await this.prisma.userOrganization.findMany({
      where: {
        organizationId,
        user: { status: { not: 'DISABLED' } },
        organization: { provider: 'dingtalk' },
      },
      include: {
        user: { include: { localCredential: true, identities: { where: { provider: 'dingtalk' } } } },
        organization: true,
      },
    })) as Member[];
    const mappings = await this.prisma.yunxiaoMemberMapping.findMany({
      where: { organizationId, yunxiaoOrganizationIdentifier },
      select: { yunxiaoUserIdentifier: true, flowxUserId: true },
    });
    const mappingByYunxiaoId = new Map(
      mappings.map((mapping) => [mapping.yunxiaoUserIdentifier, mapping.flowxUserId]),
    );

    const normalizedRecipients = this.mergeRecipients(recipients);
    const matchedByUserId = new Map<string, MatchedMember>();
    const audits: RecipientAudit[] = [];
    let openApiError: string | null = null;
    let projectMembers: YunxiaoProjectMember[] = [];
    if (!this.yunxiaoMembers.isConfigured()) {
      openApiError = 'Yunxiao API credentials are not configured.';
    } else if (projectId) {
      try {
        projectMembers = await this.yunxiaoMembers.listProjectMembers(
          yunxiaoOrganizationIdentifier,
          projectId,
        );
      } catch {
        openApiError = 'Yunxiao project member API request failed.';
      }
    }
    for (const recipient of normalizedRecipients) {
      const projectMember = projectMembers.find((member) => member.userId === recipient.id);
      const mappedFlowxUserId = recipient.id
        ? mappingByYunxiaoId.get(recipient.id)
        : undefined;
      let matched: MatchedMember | null = null;
      let reason: string | null = null;
      let dingTalkId: string | null = projectMember?.dingTalkId ?? null;
      if (!recipient.id) {
        reason = 'Yunxiao recipient identifier is missing.';
      } else if (openApiError) {
        reason = openApiError;
      } else if (!projectId) {
        reason = 'Yunxiao work item project identifier is missing.';
      } else if (mappedFlowxUserId) {
        matched = this.matchRecipientByFlowxUserId(memberships, recipient, mappedFlowxUserId);
        if (!matched) {
          reason = 'Mapped FlowX user is not an active member of the organization.';
        }
      } else {
        if (!projectMember) {
          reason = 'Yunxiao recipient is not a member of the project.';
        } else if (projectMember.dingTalkId) {
          matched = this.matchRecipientByDingTalkId(memberships, recipient, projectMember.dingTalkId);
        } else {
          reason = 'No FlowX user is mapped to the Yunxiao member.';
        }
        if (!matched) {
          reason ??= 'No FlowX member has the Yunxiao member DingTalk id.';
        }
      }
      if (!matched) {
        audits.push({ recipient, status: 'UNMATCHED', reason, dingTalkId, matchedUserId: null });
        continue;
      }
      audits.push({ recipient, status: 'MATCHED', reason: null, dingTalkId, matchedUserId: matched.userId });
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
    return {
      organizationId,
      recipients: matchedRecipients,
      audits,
      openApiError,
      unmatchedCount: audits.filter((audit) => audit.status === 'UNMATCHED').length,
    };
  }

  private async findBoundOrganizationId(yunxiaoOrganizationIdentifier: string) {
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
    return integration.organizationId;
  }

  private async recordRecipientAudits(
    audits: RecipientAudit[],
    organizationId: string,
    workItem: NormalizedWorkItem,
  ) {
    for (const audit of audits) {
      const recipientKey = this.recipientKey(audit.recipient);
      await this.prisma.yunxiaoWebhookRecipient.upsert({
        where: {
          organizationId_eventId_recipientKey: {
            organizationId,
            eventId: workItem.eventId,
            recipientKey,
          },
        },
        create: {
          organizationId,
          eventId: workItem.eventId,
          workItemId: workItem.id,
          projectId: workItem.projectId,
          recipientKey,
          yunxiaoUserIdentifier: audit.recipient.id,
          yunxiaoDisplayName: audit.recipient.name,
          roles: this.toJson(audit.recipient.roles),
          status: audit.status,
          reason: audit.reason,
          dingTalkId: audit.dingTalkId,
          matchedUserId: audit.matchedUserId,
        },
        update: {
          workItemId: workItem.id,
          projectId: workItem.projectId,
          yunxiaoUserIdentifier: audit.recipient.id,
          yunxiaoDisplayName: audit.recipient.name,
          roles: this.toJson(audit.recipient.roles),
          status: audit.status,
          reason: audit.reason,
          dingTalkId: audit.dingTalkId,
          matchedUserId: audit.matchedUserId,
          lastSeenAt: new Date(),
        },
      });
    }
  }

  private matchRecipientByDingTalkId(
    memberships: Member[],
    recipient: YunxiaoPerson,
    dingTalkId: string,
  ) {
    const role = recipient.roles[0];
    const idMatches = memberships.filter((membership) =>
      membership.user.identities.some((identity) => {
        const profile = this.asRecord(identity.providerRawProfile);
        return [
          identity.providerUserId,
          identity.providerUnionId,
          profile?.userid,
          profile?.userId,
          profile?.staffId,
          profile?.staffid,
        ].some((value) => this.same(value, dingTalkId));
      }),
    );
    if (idMatches.length === 1) {
      return this.toMatchedMember(idMatches[0], recipient, `${role}.id`);
    }
    if (idMatches.length > 1) {
      throw new UnprocessableEntityException(
        'A Yunxiao notification recipient matched multiple FlowX organization members.',
      );
    }
    return null;
  }

  private matchRecipientByFlowxUserId(
    memberships: Member[],
    recipient: YunxiaoPerson,
    flowxUserId: string,
  ) {
    const membership = memberships.find((item) => item.userId === flowxUserId);
    return membership ? this.toMatchedMember(membership, recipient, `${recipient.roles[0]}.id`) : null;
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

  private mergeRecipients(recipients: YunxiaoPerson[]) {
    const merged = new Map<string, YunxiaoPerson>();
    for (const recipient of recipients) {
      const key = this.recipientKey(recipient);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...recipient, roles: [...recipient.roles] });
        continue;
      }
      for (const role of recipient.roles) {
        if (!existing.roles.includes(role)) {
          existing.roles.push(role);
        }
      }
    }
    return [...merged.values()];
  }

  private recipientKey(recipient: YunxiaoPerson) {
    return recipient.id
      ? `id:${recipient.id}`
      : `name:${recipient.name.trim().toLocaleLowerCase()}`;
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
