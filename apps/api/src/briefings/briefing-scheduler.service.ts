import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BriefingsService } from './briefings.service';
import { DailyCodeReviewService } from './daily-code-review.service';
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
    private readonly dailyCodeReviewService: DailyCodeReviewService,
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

        let briefingMessage = '简报已生成';
        let briefingDelivered = Boolean(briefing.sentAt);
        if (briefing.sentAt) {
          briefingMessage = '简报已发送（跳过重复投递）';
        } else {
          const briefingDelivery = await this.briefingsService.sendBriefing(briefing.id);
          briefingDelivered = briefingDelivery.successCount > 0;
          briefingMessage =
            briefingDelivery.targetCount === 0
              ? '简报未配置启用的投递目标'
              : `简报投递 ${briefingDelivery.successCount}/${briefingDelivery.targetCount}`;
        }

        const codeReview = await this.dailyCodeReviewService.generateProjectDailyCodeReview(
          config.projectId,
          { date, regenerate: true },
        );
        let codeReviewMessage = 'Code Review 已生成';
        let codeReviewDelivered = Boolean(codeReview.sentAt);
        if (codeReview.sentAt) {
          codeReviewMessage = 'Code Review 已发送（跳过重复投递）';
        } else {
          const codeReviewDelivery = await this.dailyCodeReviewService.sendDailyCodeReview(
            codeReview.id,
          );
          codeReviewDelivered = codeReviewDelivery.successCount > 0;
          codeReviewMessage =
            codeReviewDelivery.targetCount === 0
              ? 'Code Review 未配置启用的投递目标'
              : `Code Review 投递 ${codeReviewDelivery.successCount}/${codeReviewDelivery.targetCount}`;
        }

        const message = `${briefingMessage}；${codeReviewMessage}`;

        if (briefingDelivered || codeReviewDelivered) {
          await this.recordSchedulerRun(config.projectId, slot, message, slot);
          this.logger.log(
            `Scheduled briefing and code review delivered for project ${config.projectId} (${config.project.name}) at slot ${slot}: ${message}.`,
          );
        } else {
          await this.recordSchedulerRun(config.projectId, null, message, null);
          this.logger.warn(
            `Scheduled briefing/code review generated but not delivered for project ${config.projectId} (${config.project.name}) at slot ${slot}: ${message}.`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.recordSchedulerRun(config.projectId, null, message, null);
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
    codeReviewSlot: string | null,
  ) {
    await this.prisma.projectBriefingConfig.update({
      where: { projectId },
      data: {
        lastSchedulerRunAt: new Date(),
        lastSchedulerMessage: message,
        ...(slot ? { lastSchedulerSlot: slot } : {}),
        ...(codeReviewSlot ? { lastCodeReviewSchedulerSlot: codeReviewSlot } : {}),
        lastCodeReviewSchedulerRunAt: new Date(),
        lastCodeReviewSchedulerMessage: message,
      },
    });
  }
}
