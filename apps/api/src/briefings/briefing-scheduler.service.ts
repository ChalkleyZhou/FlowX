import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BriefingsService } from './briefings.service';
import {
  formatBriefingDate,
  isBriefingSchedulerDue,
} from './briefing-time-window';

const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;

@Injectable()
export class BriefingSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BriefingSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly briefingsService: BriefingsService,
  ) {}

  onModuleInit() {
    if (process.env.FLOWX_BRIEFING_SCHEDULER_DISABLED === 'true') {
      return;
    }
    void this.runDueBriefings().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Project briefing scheduler failed: ${message}`);
    });
    this.timer = setInterval(() => {
      void this.runDueBriefings().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Project briefing scheduler failed: ${message}`);
      });
    }, SCHEDULER_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runDueBriefings(now = new Date()) {
    const configs = await this.prisma.projectBriefingConfig.findMany({
      where: { enabled: true },
      include: { project: true },
    });
    let generatedCount = 0;

    for (const config of configs) {
      if (!isBriefingSchedulerDue(now, config.timezone, config.dailyHour)) {
        continue;
      }
      const date = formatBriefingDate(now, config.timezone);
      const briefing = await this.briefingsService.generateProjectBriefing(config.projectId, {
        date,
      });
      generatedCount += 1;
      if (config.autoSend && !briefing.sentAt) {
        await this.briefingsService.sendBriefing(briefing.id);
      }
    }

    return { generatedCount };
  }
}
