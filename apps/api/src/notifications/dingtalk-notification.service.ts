import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePublicWebBaseUrl } from '../common/public-web-base-url';

type DingTalkNotificationRecipient = {
  flowxUserId: string;
  displayName: string;
  providerOrganizationId?: string | null;
  organizationName?: string | null;
};

type StageNotificationInput = {
  recipient?: DingTalkNotificationRecipient | null;
  workflowRunId: string;
  requirementTitle: string;
  stageName: string;
  result: string;
  nextStep?: string | null;
  detail?: string | null;
};

export type WorkItemChangeNotificationInput = {
  recipient: {
    flowxUserId: string;
    displayName: string;
    providerOrganizationId: string;
  };
  item: {
    id: string;
    displayCode: string;
    title: string;
    projectName: string;
  };
  actorName: string;
  ownerChange?: { from?: string | null; to?: string | null };
  statusChange?: { from: string; to: string };
};

const WORK_ITEM_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '进行中',
  OPEN: '待处理',
  IN_PROGRESS: '处理中',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
  WONT_FIX: '不修复',
  CONFIRMED: '已确认',
  FIXING: '修复中',
  FIXED: '已修复',
  VERIFIED: '已验证',
};

@Injectable()
export class DingTalkNotificationService {
  private readonly logger = new Logger(DingTalkNotificationService.name);
  private readonly accessTokenCache = new Map<
    string,
    {
      token: string;
      expiresAt: number;
    }
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isEnabled() {
    return Boolean(
      this.configService.get<string>('DINGTALK_APP_ID')?.trim() &&
        this.configService.get<string>('DINGTALK_APP_SECRET')?.trim() &&
        this.configService.get<string>('DINGTALK_AGENT_ID')?.trim(),
    );
  }

  async notifyStageCompleted(input: StageNotificationInput) {
    if (!this.isEnabled() || !input.recipient?.providerOrganizationId) {
      return;
    }

    try {
      const staffId = await this.resolveStaffId(
        input.recipient.flowxUserId,
        input.recipient.providerOrganizationId,
      );
      if (!staffId) {
        this.logger.warn(
          `Skip DingTalk personal notification because no staffId was found for user ${input.recipient.flowxUserId}.`,
        );
        return;
      }

      const accessToken = await this.getAppAccessToken(input.recipient.providerOrganizationId);
      if (!accessToken) {
        return;
      }

      const url = new URL('https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2');
      url.searchParams.set('access_token', accessToken);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: Number(this.configService.get<string>('DINGTALK_AGENT_ID')),
          userid_list: staffId,
          msg: {
            msgtype: 'text',
            text: {
              content: this.buildStageCompletedText(input),
            },
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            errcode?: number | string;
            errmsg?: string;
          }
        | null;

      if (!response.ok || Number(payload?.errcode ?? 0) !== 0) {
        this.logger.warn(
          `DingTalk personal notification failed: ${response.status} ${payload?.errmsg ?? 'unknown error'}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DingTalk personal notification error: ${message}`);
    }
  }

  private buildStageCompletedText(input: StageNotificationInput) {
    const lines = [
      'FlowX 阶段完成通知',
      `工作流：${input.workflowRunId}`,
      `需求：${input.requirementTitle}`,
      `阶段：${input.stageName}`,
      `结果：${input.result}`,
    ];

    if (input.nextStep?.trim()) {
      lines.push(`下一步：${input.nextStep.trim()}`);
    }

    if (input.detail?.trim()) {
      lines.push(`说明：${input.detail.trim()}`);
    }

    return lines.join('\n');
  }

  async sendPersonalMarkdown(input: {
    flowxUserId: string;
    corpId: string;
    title: string;
    markdown: string;
  }) {
    if (!this.isEnabled()) {
      throw new Error('DingTalk app delivery is not configured.');
    }

    const staffId = await this.resolveStaffId(input.flowxUserId, input.corpId);
    if (!staffId) {
      throw new Error('DingTalk staff id not found for user.');
    }

    const accessToken = await this.getAppAccessToken(input.corpId);
    if (!accessToken) {
      throw new Error('DingTalk access token is unavailable.');
    }

    const url = new URL('https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2');
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: Number(this.configService.get<string>('DINGTALK_AGENT_ID')),
        userid_list: staffId,
        msg: {
          msgtype: 'markdown',
          markdown: {
            title: input.title,
            text: input.markdown,
          },
        },
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          errcode?: number | string;
          errmsg?: string;
          task_id?: number;
        }
      | null;

    if (!response.ok || Number(payload?.errcode ?? 0) !== 0) {
      throw new Error(
        `DingTalk personal notification failed: ${payload?.errmsg ?? response.status}`,
      );
    }

    return payload;
  }

  async sendWorkItemChangeMarkdown(input: WorkItemChangeNotificationInput) {
    if (!this.isEnabled()) {
      this.logger.warn('Skip work item change notification because DingTalk app delivery is not configured.');
      return;
    }

    const corpId = input.recipient.providerOrganizationId?.trim();
    if (!corpId) {
      this.logger.warn(`Skip work item change notification because organization provider id is missing for ${input.item.id}.`);
      return;
    }

    try {
      await this.sendPersonalMarkdown({
        flowxUserId: input.recipient.flowxUserId,
        corpId,
        title: 'FlowX 工作项发生变更',
        markdown: this.buildWorkItemChangeMarkdown(input),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DingTalk work item change notification failed: ${message}`);
    }
  }

  private buildWorkItemChangeMarkdown(input: WorkItemChangeNotificationInput) {
    const lines = [
      `## ${input.item.displayCode} ${input.item.title}`,
      '',
      `- 项目：${input.item.projectName}`,
      `- 变更人：${input.actorName || '未记录'}`,
    ];

    if (input.ownerChange) {
      lines.push(`- 负责人：${this.formatOwnerName(input.ownerChange.from)} → ${this.formatOwnerName(input.ownerChange.to)}`);
    }

    if (input.statusChange) {
      lines.push(`- 状态：${this.formatStatus(input.statusChange.from)} → ${this.formatStatus(input.statusChange.to)}`);
    }

    const publicWebBaseUrl = resolvePublicWebBaseUrl({
      FLOWX_PUBLIC_WEB_URL: this.configService.get<string>('FLOWX_PUBLIC_WEB_URL'),
      PUBLIC_WEB_URL: this.configService.get<string>('PUBLIC_WEB_URL'),
    });
    if (publicWebBaseUrl) {
      lines.push('', `[查看工作项](${publicWebBaseUrl}/work-items/${encodeURIComponent(input.item.id)})`);
    } else {
      this.logger.warn(`DingTalk work item change notification has no public Web URL for ${input.item.id}.`);
    }

    return lines.join('\n');
  }

  private formatOwnerName(value?: string | null) {
    return value?.trim() || '未指定';
  }

  private formatStatus(value: string) {
    return WORK_ITEM_STATUS_LABELS[value] ?? value;
  }

  async fetchStaffEmail(flowxUserId: string, corpId: string) {
    const staffId = await this.resolveStaffId(flowxUserId, corpId);
    if (!staffId) {
      return null;
    }

    const accessToken = await this.getAppAccessToken(corpId);
    if (!accessToken) {
      return null;
    }

    return this.fetchEmailByStaffId(staffId, accessToken);
  }

  private async fetchEmailByStaffId(staffId: string, accessToken: string) {
    const url = new URL('https://oapi.dingtalk.com/topapi/v2/user/get');
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userid: staffId,
        language: 'zh_CN',
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          errcode?: number | string;
          errmsg?: string;
          result?: {
            email?: string;
            org_email?: string;
          };
        }
      | null;

    if (!response.ok || Number(payload?.errcode ?? 0) !== 0) {
      this.logger.warn(
        `Fetch DingTalk user email failed for staff ${staffId}: ${response.status} ${payload?.errmsg ?? 'unknown error'}`,
      );
      return null;
    }

    return this.pickString(payload?.result?.org_email, payload?.result?.email);
  }

  private async resolveStaffId(flowxUserId: string, corpId: string) {
    const identity = await this.prisma.authIdentity.findFirst({
      where: {
        userId: flowxUserId,
        provider: 'dingtalk',
      },
    });

    if (!identity) {
      return null;
    }

    const rawProfile = this.asRecord(identity.providerRawProfile);
    const directStaffId = this.pickString(
      rawProfile?.userid,
      rawProfile?.userId,
      rawProfile?.staffId,
      rawProfile?.staffid,
    );
    if (directStaffId) {
      return directStaffId;
    }

    const unionId = this.pickString(
      identity.providerUnionId,
      rawProfile?.unionId,
      rawProfile?.unionid,
    );
    if (!unionId) {
      return null;
    }

    const accessToken = await this.getAppAccessToken(corpId);
    if (!accessToken) {
      return null;
    }

    const url = new URL('https://oapi.dingtalk.com/topapi/user/getbyunionid');
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        unionid: unionId,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          errcode?: number | string;
          errmsg?: string;
          result?: {
            userid?: string;
          };
        }
      | null;

    if (!response.ok || Number(payload?.errcode ?? 0) !== 0) {
      this.logger.warn(
        `Resolve DingTalk staffId failed for user ${flowxUserId}: ${response.status} ${payload?.errmsg ?? 'unknown error'}`,
      );
      return null;
    }

    return this.pickString(payload?.result?.userid);
  }

  private async getAppAccessToken(corpId: string) {
    const cacheKey = corpId.trim();
    const cached = this.accessTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const clientId = this.configService.get<string>('DINGTALK_APP_ID')?.trim();
    const clientSecret = this.configService.get<string>('DINGTALK_APP_SECRET')?.trim();
    if (!clientId || !clientSecret) {
      return null;
    }

    const response = await fetch(
      `https://api.dingtalk.com/v1.0/oauth2/${encodeURIComponent(cacheKey)}/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
        }),
      },
    );

    const payload = (await response.json().catch(() => null)) as
      | {
          access_token?: string;
          expires_in?: number;
          code?: string;
          message?: string;
        }
      | null;

    if (!response.ok || !payload?.access_token) {
      this.logger.warn(
        `Fetch DingTalk access token failed for corp ${corpId}: ${response.status} ${payload?.message ?? payload?.code ?? 'unknown error'}`,
      );
      return null;
    }

    const expiresIn = Number(payload.expires_in ?? 7200);
    this.accessTokenCache.set(cacheKey, {
      token: payload.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    });

    return payload.access_token;
  }

  private pickString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
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
}
