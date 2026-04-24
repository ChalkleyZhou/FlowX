import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type IdeationSessionEventType =
  | 'STARTED'
  | 'STAGE'
  | 'HEARTBEAT'
  | 'STDERR'
  | 'STDOUT'
  | 'RETRY'
  | 'FAILED'
  | 'COMPLETED';

export type IdeationSessionStage =
  | 'QUEUE'
  | 'CONTEXT_SCAN'
  | 'MODEL_RUNNING'
  | 'JSON_PARSE'
  | 'WRITE_FILES'
  | 'PREVIEW_START'
  | 'FINALIZE';

export type AppendIdeationSessionEventInput = {
  sessionId: string;
  eventType: IdeationSessionEventType;
  stage: IdeationSessionStage;
  message: string;
  details?: Record<string, unknown>;
};

@Injectable()
export class IdeationSessionEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  append(input: AppendIdeationSessionEventInput) {
    return this.prisma.ideationSessionEvent.create({
      data: {
        sessionId: input.sessionId,
        eventType: input.eventType,
        stage: input.stage,
        message: input.message,
        details: input.details ? (input.details as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  list(sessionId: string) {
    return this.prisma.ideationSessionEvent.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
