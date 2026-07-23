import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { resolvePublicApiBaseUrl } from '../common/public-api-base-url';
import { buildLocalChatPrompt } from './local-chat-prompt';
import { LocalLaunchTicketStore } from './local-launch-ticket.store';
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
    options?: { ttlMs?: number },
  ) {
    // Ensure the run is claimed for local execution and readable before issuing a ticket.
    await this.workflowService.getLocalHandoff(workflowRunId);

    const ttlMs = options?.ttlMs ?? DEFAULT_TICKET_TTL_MS;
    const expiresAt = Date.now() + ttlMs;
    const record = this.ticketStore.create({
      workflowRunId,
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
    const handoff = await this.workflowService.getLocalHandoff(record.workflowRunId);
    const repository = handoff.repositories[0];
    if (this.isExecutionSessionProjectionEnabled() && !handoff.executionSessionId?.trim()) {
      throw new BadRequestException(
        'Local execution handoff is missing an execution session id. Create a new local launch ticket.',
      );
    }
    const chatPrompt = buildLocalChatPrompt({
      taskType: 'requirement',
      taskId: handoff.requirement.id,
      workflowRunId: handoff.workflowRunId,
      executionSessionId: handoff.executionSessionId,
      workflowRepositoryId: repository?.workflowRepositoryId,
      title: handoff.requirement.title,
      description: handoff.requirement.description,
      acceptanceCriteria: handoff.requirement.acceptanceCriteria,
      repository: {
        name: repository?.name ?? 'unknown',
        url: repository?.url ?? null,
        workingBranch: repository?.workingBranch ?? '',
      },
    });

    const shortLived = await this.authService.createShortLivedSession(
      record.userId,
      record.organizationId,
    );

    return {
      apiBaseUrl: resolvePublicApiBaseUrl(),
      workflowRunId: record.workflowRunId,
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
