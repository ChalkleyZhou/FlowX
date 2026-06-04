import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BriefingsService } from './briefings.service';
import {
  formatBriefingDate,
  isBriefingSchedulerDue,
} from './briefing-time-window';

const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

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
      this.logger.warn('Project briefing scheduler is disabled by FLOWX_BRIEFING_SCHEDULER_DISABLED.');
      return;
    }

    void this.syncLegacyAutoSendFlags()
      .then(() => this.runDueBriefings())
      .catch((error) => {
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

  private async syncLegacyAutoSendFlags() {
    const updated = await this.prisma.projectBriefingConfig.updateMany({
      where: { enabled: true, autoSend: false },
      data: { autoSend: true },
    });
    if (updated.count > 0) {
      this.logger.log(`Synced autoSend for ${updated.count} enabled briefing config(s).`);
    }
  }

  async runDueBriefings(now = new Date()) {
    const configs = await this.prisma.projectBriefingConfig.findMany({
      where: { enabled: true },
      include: { project: true },
    });
    let generatedCount = 0;

    for (const config of configs) {
      if (!isBriefingSchedulerDue(now, config.dailyHour)) {
        continue;
      }

      const date = formatBriefingDate(now);
      const slot = `${date}@${config.dailyHour}`;

      if (config.lastSchedulerSlot === slot) {
        continue;
      }

      try {
        const briefing = await this.briefingsService.generateProjectBriefing(config.projectId, {
          date,
          regenerate: true,
        });
        generatedCount += 1;

        if (briefing.sentAt) {
          await this.recordSchedulerRun(config.projectId, slot, '已发送（跳过重复投递）');
          continue;
        }

        const delivery = await this.briefingsService.sendBriefing(briefing.id);
        const message =
          delivery.targetCount === 0
            ? '未配置启用的投递目标'
            : `投递 ${delivery.successCount}/${delivery.targetCount}`;

        if (delivery.successCount > 0) {
          await this.recordSchedulerRun(config.projectId, slot, message);
          this.logger.log(
            `Scheduled briefing delivered for project ${config.projectId} (${config.project.name}) at slot ${slot}: ${message}.`,
          );
        } else {
          await this.recordSchedulerRun(config.projectId, null, message);
          this.logger.warn(
            `Scheduled briefing generated but not delivered for project ${config.projectId} (${config.project.name}) at slot ${slot}: ${message}.`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.recordSchedulerRun(config.projectId, null, message);
        this.logger.warn(
          `Scheduled briefing failed for project ${config.projectId} (${config.project.name}) at slot ${slot}: ${message}`,
        );
      }
    }

    return { generatedCount };
  }

  private async recordSchedulerRun(
    projectId: string,
    slot: string | null,
    message: string,
  ) {
    await this.prisma.projectBriefingConfig.update({
      where: { projectId },
      data: {
        lastSchedulerRunAt: new Date(),
        lastSchedulerMessage: message,
        ...(slot ? { lastSchedulerSlot: slot } : {}),
      },
    });
  }
}
