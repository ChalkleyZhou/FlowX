import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

export type LocalLaunchTicketRecord = {
  ticket: string;
  workflowRunId: string;
  userId: string;
  organizationId: string | null;
  expiresAt: number;
  consumedAt?: number;
};

@Injectable()
export class LocalLaunchTicketStore {
  private readonly tickets = new Map<string, LocalLaunchTicketRecord>();

  create(
    record: Omit<LocalLaunchTicketRecord, 'ticket'> & { ticket?: string },
  ): LocalLaunchTicketRecord {
    const ticket = record.ticket ?? randomBytes(32).toString('hex');
    const stored: LocalLaunchTicketRecord = {
      ticket,
      workflowRunId: record.workflowRunId,
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
