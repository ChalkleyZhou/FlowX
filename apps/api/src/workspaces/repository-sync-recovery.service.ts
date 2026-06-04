import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RepositorySyncService } from './repository-sync.service';

function isRecoveryEnabled() {
  const raw = process.env.FLOWX_RECOVER_REPOSITORY_SYNC_ON_BOOT?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function staleRepositorySyncThresholdMs() {
  const raw = process.env.FLOWX_REPOSITORY_SYNC_STALE_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 120_000;
}

@Injectable()
export class RepositorySyncRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(RepositorySyncRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repositorySyncService: RepositorySyncService,
  ) {}

  async onModuleInit() {
    if (!isRecoveryEnabled()) {
      this.logger.log(
        'Skipping repository sync recovery on boot (FLOWX_RECOVER_REPOSITORY_SYNC_ON_BOOT disabled).',
      );
      return;
    }
    await this.recoverStaleRepositorySyncs();
  }

  private async recoverStaleRepositorySyncs() {
    const thresholdMs = staleRepositorySyncThresholdMs();
    const staleBefore = new Date(Date.now() - thresholdMs);
    const staleRepositories = await this.prisma.repository.findMany({
      where: {
        status: 'ACTIVE',
        syncStatus: { in: ['PENDING', 'SYNCING'] },
        updatedAt: { lt: staleBefore },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (staleRepositories.length === 0) {
      return;
    }

    this.logger.warn(
      `Recovering ${staleRepositories.length} stale repository sync job(s) (threshold=${thresholdMs}ms).`,
    );

    for (const repository of staleRepositories) {
      this.repositorySyncService.scheduleRepositorySync(repository);
    }
  }
}
