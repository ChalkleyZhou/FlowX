import { ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  BrainstormCompletionReport,
  DesignCompletionReport,
  OpenDesignBrainstormHandoff,
  OpenDesignHandoff,
} from '@flowx-ai/protocol';
import { AuthService } from '../auth/auth.service';
import { WorkflowRunStatus, WorkflowRunType } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import type { EdgeWorkflowSession } from './edge-tasks.service';

const READY_POLL_INTERVAL_MS = 250;
const READY_TIMEOUT_MS = 15_000;
const TICKET_TTL_MS = 5 * 60 * 1000;
const LOOPBACK_PORT = 3920;

type TicketStage = 'brainstorm' | 'design';

type TicketRecord = {
  workflowRunId: string;
  userId: string;
  organizationId: string | null;
  stage: TicketStage;
  expiresAt: number;
  consumed: boolean;
};

@Injectable()
export class OpenDesignEdgeService {
  private readonly tickets = new Map<string, TicketRecord>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowService: WorkflowService,
    private readonly authService: AuthService,
  ) {}

  async startHandoff(
    input: { requirementId: string; repositoryIds?: string[] },
    session: EdgeWorkflowSession,
  ) {
    let workflow = await this.prisma.workflowRun.findFirst({
      where: {
        requirementId: input.requirementId,
        runType: WorkflowRunType.LOCAL_DESIGN,
        status: { notIn: ['DONE', 'FAILED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!workflow) {
      workflow = await this.workflowService.createLocalDesignWorkflowRun({
        requirementId: input.requirementId,
        repositoryIds: input.repositoryIds,
      });
    }

    const ready = await this.waitUntilDesignPending(workflow);
    if (!ready) {
      throw new ConflictException('OpenDesign workflow is still preparing repositories. Please retry shortly.');
    }
    const claimed = await this.workflowService.claimLocalDesign(ready.id, session);
    const ticket = this.issueTicket(claimed.handoff, session, 'design');
    return {
      ...claimed,
      ticket,
      loopbackPort: LOOPBACK_PORT,
    };
  }

  async retryHandoff(workflowRunId: string, session: EdgeWorkflowSession) {
    const workflow = await this.workflowService.findOne(workflowRunId);
    const claimed = await this.workflowService.claimLocalDesign(workflowRunId, session);
    return {
      workflow,
      handoff: claimed.handoff,
      ticket: this.issueTicket(claimed.handoff, session, 'design'),
      loopbackPort: LOOPBACK_PORT,
    };
  }

  async retryBrainstormHandoff(workflowRunId: string, session: EdgeWorkflowSession) {
    const workflow = await this.workflowService.findOne(workflowRunId);
    const claimed = await this.workflowService.claimLocalBrainstorm(workflowRunId, session);
    return {
      workflow,
      handoff: claimed.handoff,
      ticket: this.issueTicket(claimed.handoff, session, 'brainstorm'),
      loopbackPort: LOOPBACK_PORT,
    };
  }

  getHandoff(workflowRunId: string) {
    return this.workflowService.getLocalDesignHandoff(workflowRunId);
  }

  getBrainstormHandoff(workflowRunId: string) {
    return this.workflowService.getLocalBrainstormHandoff(workflowRunId);
  }

  async redeem(ticket: string) {
    const record = this.tickets.get(ticket);
    if (!record || record.consumed || Date.now() >= record.expiresAt) {
      throw new ConflictException('OpenDesign launch ticket is invalid or expired.');
    }
    record.consumed = true;
    this.tickets.delete(ticket);
    const handoff =
      record.stage === 'brainstorm'
        ? await this.workflowService.getLocalBrainstormHandoff(record.workflowRunId)
        : await this.workflowService.getLocalDesignHandoff(record.workflowRunId);
    const shortLived = await this.authService.createShortLivedSession(
      record.userId,
      record.organizationId,
    );
    return {
      kind: record.stage === 'brainstorm' ? 'opendesign-brainstorm' : 'opendesign',
      stage: record.stage,
      apiBaseUrl: `http://127.0.0.1:${process.env.PORT || '3000'}`,
      handoff,
      accessToken: shortLived.token,
      accessTokenExpiresAt: shortLived.expiresAt,
    };
  }

  complete(
    executionSessionId: string,
    report: DesignCompletionReport,
    scope: { organizationId?: string | null },
  ) {
    return this.workflowService.completeLocalDesignSession(
      executionSessionId,
      report,
      scope,
    );
  }

  completeBrainstorm(
    executionSessionId: string,
    report: BrainstormCompletionReport,
    scope: { organizationId?: string | null },
  ) {
    return this.workflowService.completeLocalBrainstormSession(
      executionSessionId,
      report,
      scope,
    );
  }

  private issueTicket(
    handoff: OpenDesignHandoff | OpenDesignBrainstormHandoff,
    session: EdgeWorkflowSession,
    stage: TicketStage,
  ) {
    const ticket = randomBytes(32).toString('hex');
    this.tickets.set(ticket, {
      workflowRunId: handoff.workflowRunId,
      userId: session.user.id,
      organizationId: session.organization?.id ?? null,
      stage,
      expiresAt: Date.now() + TICKET_TTL_MS,
      consumed: false,
    });
    return ticket;
  }

  private async waitUntilDesignPending(workflow: { id: string; status: string }) {
    if (workflow.status.toLowerCase() === WorkflowRunStatus.DESIGN_PENDING) {
      return workflow;
    }
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
      const latest = await this.workflowService.findOne(workflow.id);
      const status = latest.status.toLowerCase();
      if (status === WorkflowRunStatus.DESIGN_PENDING) return latest;
      if ([WorkflowRunStatus.FAILED, WorkflowRunStatus.DONE].includes(status as WorkflowRunStatus)) {
        return null;
      }
    }
    return null;
  }
}
