import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { resolvePublicApiBaseUrl } from '../common/public-api-base-url';
import { buildLocalChatPrompt } from './local-chat-prompt';
import { LocalLaunchTicketStore, type LocalLaunchStage } from './local-launch-ticket.store';
import { WorkflowService } from './workflow.service';

const DEFAULT_TICKET_TTL_MS = 5 * 60 * 1000;
const LOOPBACK_PORT = 3920;

export type LocalLaunchAuthSession = {
  user: {
    id: string;
    displayName?: string;
  };
  organization?: {
    id?: string | null;
  } | null;
};

@Injectable()
export class LocalLaunchService {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly authService: AuthService,
    private readonly ticketStore: LocalLaunchTicketStore,
  ) {}

  async issueTicket(
    workflowRunId: string,
    session: LocalLaunchAuthSession,
    options?: { ttlMs?: number; stage?: LocalLaunchStage },
  ) {
    const stage = options?.stage ?? 'EXECUTION';
    // 确保本地启动票据只会绑定到已领取且可读取的阶段会话。
    if (stage === 'SPEC_PLAN') {
      await this.workflowService.claimLocalSpecPlan(workflowRunId, {
        user: { id: session.user.id, displayName: session.user.displayName ?? '' },
        organization: session.organization,
      });
    } else {
      await this.workflowService.getLocalHandoff(workflowRunId);
    }

    const ttlMs = options?.ttlMs ?? DEFAULT_TICKET_TTL_MS;
    const expiresAt = Date.now() + ttlMs;
    const record = this.ticketStore.create({
      workflowRunId,
      stage,
      userId: session.user.id,
      organizationId: session.organization?.id ?? null,
      expiresAt,
    });

    return {
      ticket: record.ticket,
      expiresAt: new Date(record.expiresAt),
      loopbackPort: LOOPBACK_PORT,
    };
  }

  async redeemTicket(ticket: string) {
    const record = this.ticketStore.consume(ticket);
    let handoff: Awaited<ReturnType<WorkflowService['getLocalHandoff']>> | Awaited<ReturnType<WorkflowService['getLocalSpecPlanHandoff']>>;
    let chatPrompt: string;
    if (record.stage === 'SPEC_PLAN') {
      const specPlanHandoff = await this.workflowService.getLocalSpecPlanHandoff(record.workflowRunId);
      if (!specPlanHandoff.executionSessionId.trim()) {
        throw new BadRequestException(
          'Local Spec & Plan handoff is missing an execution session id. Create a new local launch ticket.',
        );
      }
      handoff = specPlanHandoff;
      chatPrompt = buildLocalSpecPlanPrompt(specPlanHandoff);
    } else {
      const executionHandoff = await this.workflowService.getLocalHandoff(record.workflowRunId);
      if (this.isExecutionSessionProjectionEnabled() && !executionHandoff.executionSessionId?.trim()) {
        throw new BadRequestException(
          'Local execution handoff is missing an execution session id. Create a new local launch ticket.',
        );
      }
      const repository = executionHandoff.repositories[0];
      handoff = executionHandoff;
      chatPrompt = buildLocalChatPrompt({
        taskType: 'requirement',
        taskId: executionHandoff.requirement.id,
        workflowRunId: executionHandoff.workflowRunId,
        executionSessionId: executionHandoff.executionSessionId,
        workflowRepositoryId: repository?.workflowRepositoryId,
        title: executionHandoff.requirement.title,
        description: executionHandoff.requirement.description,
        acceptanceCriteria: executionHandoff.requirement.acceptanceCriteria,
        repository: {
          name: repository?.name ?? 'unknown',
          url: repository?.url ?? null,
          workingBranch: repository?.workingBranch ?? '',
        },
      });
    }

    const shortLived = await this.authService.createShortLivedSession(
      record.userId,
      record.organizationId,
    );

    return {
      apiBaseUrl: resolvePublicApiBaseUrl(),
      workflowRunId: record.workflowRunId,
      stage: record.stage,
      handoff,
      chatPrompt,
      mcpToken: shortLived.token,
      mcpTokenExpiresAt: shortLived.expiresAt,
    };
  }

  private isExecutionSessionProjectionEnabled() {
    return process.env.FLOWX_EXECUTION_SESSION_WRITE_ENABLED?.trim().toLowerCase() !== 'false';
  }

}

function buildLocalSpecPlanPrompt(handoff: {
  workflowRunId: string;
  executionSessionId: string;
  contextPackage: {
    requirement: { title: string; description: string; acceptanceCriteria: string };
  };
}) {
  const requirement = handoff.contextPackage.requirement;
  return [
    `# FlowX Spec & Plan: ${requirement.title}`,
    '',
    '## 任务',
    requirement.description,
    '',
    '## 验收标准',
    requirement.acceptanceCriteria,
    '',
    '## 本地工作流',
    `- Workflow run id: ${handoff.workflowRunId}`,
    `- Execution session id: ${handoff.executionSessionId}`,
    '- 使用 FlowX MCP 获取完整 handoff 上下文。',
    '- 生成结构化 spec-plan.json、spec.md 和 plan.md。',
    '- 先上传 spec.md（SPEC_MARKDOWN）和 plan.md（PLAN_MARKDOWN），再调用 flowx_submit_spec_plan。',
    '- 回传成功后停止，不要自动确认 Web 阶段。',
  ].join('\n');
}
