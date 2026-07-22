import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ExecutionSessionsService,
  type ExecutionSessionScope,
} from '../execution-sessions/execution-sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RegisterEvidenceDto } from './dto/register-evidence.dto';

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executionSessionsService: ExecutionSessionsService,
  ) {}

  async register(
    executionSessionId: string,
    input: RegisterEvidenceDto,
    scope: ExecutionSessionScope = {},
  ) {
    const session = await this.executionSessionsService.requireAccessibleSession(
      executionSessionId,
      scope,
    );
    const artifactId = input.artifactId?.trim() || null;
    if (artifactId) {
      const artifact = await this.prisma.artifact.findUnique({ where: { id: artifactId } });
      if (!artifact || artifact.status === 'DELETED') {
        throw new NotFoundException('Artifact not found.');
      }
      const belongsToSession = artifact.executionSessionId === executionSessionId;
      const belongsToWorkflow =
        !artifact.executionSessionId &&
        artifact.workflowRunId === session.workflowRunId &&
        artifact.workspaceId === session.workspaceId;
      if (!belongsToSession && !belongsToWorkflow) {
        throw new BadRequestException('Evidence artifact does not belong to this execution session.');
      }
    }

    return this.prisma.evidence.create({
      data: {
        executionSessionId,
        artifactId,
        evidenceType: input.evidenceType,
        sourceTool: input.sourceTool,
        title: input.title.trim(),
        summary: input.summary?.trim() || null,
        status: input.status ?? 'REPORTED',
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        metadata: toInputJson(input.metadata),
      },
    });
  }

  async list(executionSessionId: string, scope: ExecutionSessionScope = {}) {
    await this.executionSessionsService.requireAccessibleSession(executionSessionId, scope);
    return this.prisma.evidence.findMany({
      where: { executionSessionId },
      include: { artifact: true },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
  }
}

function toInputJson(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonObject);
}
