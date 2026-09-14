import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

export type LocalLaunchStage = 'EXECUTION' | 'SPEC_PLAN';

export type LocalLaunchTicketRecord = {
  ticket: string;
  workflowRunId: string;
  stage: LocalLaunchStage;
  userId: string;
  organizationId: string | null;
  expiresAt: number;
  consumedAt?: number;
};

@Injectable()
export class LocalLaunchTicketStore {
  private readonly tickets = new Map<string, LocalLaunchTicketRecord>();

  create(
    record: Omit<LocalLaunchTicketRecord, 'ticket' | 'stage'> & { ticket?: string; stage?: LocalLaunchStage },
  ): LocalLaunchTicketRecord {
    const ticket = record.ticket ?? randomBytes(32).toString('hex');
    const stored: LocalLaunchTicketRecord = {
      ticket,
      workflowRunId: record.workflowRunId,
      stage: record.stage ?? 'EXECUTION',
      userId: record.userId,
      organizationId: record.organizationId,
      expiresAt: record.expiresAt,
      consumedAt: record.consumedAt,
    };
    this.tickets.set(ticket, stored);
    return stored;
  }

  consume(ticket: string): LocalLaunchTicketRecord {
    const record = this.tickets.get(ticket);
    if (!record) {
      throw new Error('Launch ticket is invalid or expired.');
    }
    if (record.consumedAt != null) {
      throw new Error('Launch ticket is invalid or expired.');
    }
    if (Date.now() >= record.expiresAt) {
      throw new Error('Launch ticket is invalid or expired.');
    }

    const consumed: LocalLaunchTicketRecord = {
      ...record,
      consumedAt: Date.now(),
    };
    this.tickets.set(ticket, consumed);
    return consumed;
  }
}
