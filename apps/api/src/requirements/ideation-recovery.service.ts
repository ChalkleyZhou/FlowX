import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ideationStatusOrder = [
  'NONE',
  'BRAINSTORM_WAITING_CONFIRMATION',
  'BRAINSTORM_CONFIRMED',
  'DESIGN_WAITING_CONFIRMATION',
  'DESIGN_CONFIRMED',
  'DEMO_WAITING_CONFIRMATION',
  'DEMO_CONFIRMED',
  'FINALIZED',
] as const;

type StableIdeationStatus = (typeof ideationStatusOrder)[number];

function isRecoveryEnabled() {
  const raw = process.env.FLOWX_RECOVER_IDEATION_ON_BOOT?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function staleHeartbeatThresholdMs() {
  const raw = process.env.FLOWX_IDEATION_STALE_HEARTBEAT_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 120_000;
}

@Injectable()
export class IdeationRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(IdeationRecoveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!isRecoveryEnabled()) {
      this.logger.log('Skipping ideation recovery on boot (FLOWX_RECOVER_IDEATION_ON_BOOT disabled).');
      return;
    }
    await this.recoverStaleRunningIdeationSessions();
  }

  private async recoverStaleRunningIdeationSessions() {
    const runningSessions = await this.prisma.ideationSession.findMany({
      where: { status: 'RUNNING' },
      select: { id: true, requirementId: true, stage: true, startedAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    if (runningSessions.length === 0) {
      return;
    }

    const now = new Date();
    const thresholdMs = staleHeartbeatThresholdMs();
    const latestEvents = await this.prisma.ideationSessionEvent.findMany({
      where: { sessionId: { in: runningSessions.map((session) => session.id) } },
      select: { sessionId: true, createdAt: true },
      orderBy: [{ sessionId: 'asc' }, { createdAt: 'desc' }],
    });
    const latestEventMap = new Map<string, Date>();
    for (const event of latestEvents) {
      if (!latestEventMap.has(event.sessionId)) {
        latestEventMap.set(event.sessionId, event.createdAt);
      }
    }
    const staleSessionIds = runningSessions
      .filter((session) => {
        const lastSeenAt = latestEventMap.get(session.id) ?? session.startedAt ?? session.createdAt;
        return now.getTime() - lastSeenAt.getTime() > thresholdMs;
      })
      .map((session) => session.id);

    if (staleSessionIds.length === 0) {
      this.logger.log(
        `Skipped stale ideation recovery: ${runningSessions.length} RUNNING session(s) have recent heartbeat/activity.`,
      );
      return;
    }

    await this.prisma.ideationSession.updateMany({
      where: { id: { in: staleSessionIds } },
      data: {
        status: 'FAILED',
        statusMessage: 'Recovered after service restart.',
        errorMessage: 'IDEATION_SESSION_STALE_RUNNING: Service restarted while session was RUNNING.',
        finishedAt: now,
      },
    });

    const requirementIds = Array.from(
      new Set(runningSessions.filter((session) => staleSessionIds.includes(session.id)).map((session) => session.requirementId)),
    );
    for (const requirementId of requirementIds) {
      await this.reconcileRequirementIdeationStatus(requirementId);
    }

    this.logger.warn(
      `Recovered ${staleSessionIds.length} stale ideation RUNNING session(s) across ${requirementIds.length} requirement(s).`,
    );
  }

  private async reconcileRequirementIdeationStatus(requirementId: string) {
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      select: {
        id: true,
        ideationStatus: true,
        ideationSessions: {
          where: { stage: { in: ['BRAINSTORM', 'DESIGN', 'DEMO'] } },
          select: { stage: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        ideationArtifacts: {
          where: { type: { in: ['BRAINSTORM_BRIEF', 'DESIGN_SPEC', 'DEMO_PAGE'] } },
          select: { type: true },
        },
      },
    });

    if (!requirement) {
      return;
    }

    const nextStatus = this.computeStableStatus(requirement);
    if (requirement.ideationStatus === nextStatus) {
      return;
    }

    await this.prisma.requirement.update({
      where: { id: requirement.id },
      data: { ideationStatus: nextStatus },
    });
  }

  private computeStableStatus(requirement: {
    ideationStatus: string;
    ideationSessions: Array<{ stage: string; status: string; createdAt: Date }>;
    ideationArtifacts: Array<{ type: string }>;
  }): StableIdeationStatus {
    if (requirement.ideationStatus === 'FINALIZED') {
      return 'FINALIZED';
    }

    const hasDesignWaiting = requirement.ideationSessions.some(
      (session) => session.stage === 'DESIGN' && session.status === 'WAITING_CONFIRMATION',
    );
    if (hasDesignWaiting) {
      return 'DESIGN_WAITING_CONFIRMATION';
    }

    const hasDesignArtifact = requirement.ideationArtifacts.some((artifact) => artifact.type === 'DESIGN_SPEC');
    const hasDemoWaiting = requirement.ideationSessions.some(
      (session) => session.stage === 'DEMO' && session.status === 'WAITING_CONFIRMATION',
    );
    if (hasDemoWaiting) {
      return 'DEMO_WAITING_CONFIRMATION';
    }

    const hasDemoArtifact = requirement.ideationArtifacts.some((artifact) => artifact.type === 'DEMO_PAGE');
    if (hasDemoArtifact) {
      return 'DEMO_CONFIRMED';
    }

    if (hasDesignArtifact) {
      return 'DESIGN_CONFIRMED';
    }

    const hasBrainstormWaiting = requirement.ideationSessions.some(
      (session) => session.stage === 'BRAINSTORM' && session.status === 'WAITING_CONFIRMATION',
    );
    if (hasBrainstormWaiting) {
      return 'BRAINSTORM_WAITING_CONFIRMATION';
    }

    const hasBrainstormArtifact = requirement.ideationArtifacts.some(
      (artifact) => artifact.type === 'BRAINSTORM_BRIEF',
    );
    if (hasBrainstormArtifact) {
      return 'BRAINSTORM_CONFIRMED';
    }

    return 'NONE';
  }
}

