import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildSchedulerAuthSession,
  resolveProjectOrganizationId,
} from './briefing-auth-session';
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
    const updated = await this.prisma.briefingFeed.updateMany({
      where: { enabled: true, autoSend: false },
      data: { autoSend: true },
    });
    if (updated.count > 0) {
      this.logger.log(`Synced autoSend for ${updated.count} enabled briefing config(s).`);
    }
  }

  async runDueBriefings(now = new Date()) {
    const feeds = await this.prisma.briefingFeed.findMany({
      where: { enabled: true },
      include: { project: true },
    });
    let generatedCount = 0;

    for (const feed of feeds) {
      if (!isBriefingSchedulerDue(now, feed.dailyHour)) {
        continue;
      }

      const date = formatBriefingDate(now);
      const slot = `${date}@${feed.dailyHour}`;

      if (feed.lastSchedulerSlot === slot) {
        continue;
      }

      try {
        const organizationId = await resolveProjectOrganizationId(this.prisma, feed.projectId);
        const schedulerAuthSession = organizationId
          ? await buildSchedulerAuthSession(this.prisma, organizationId)
          : undefined;

        const briefing = await this.briefingsService.generateFeedBriefing(
          feed.id,
          {
            date,
            regenerate: true,
          },
          schedulerAuthSession,
        );
        generatedCount += 1;

        let message = '简报已生成';
        let delivered = Boolean(briefing.sentAt);
        if (briefing.sentAt) {
          message = '简报已发送（跳过重复投递）';
        } else {
          const delivery = await this.briefingsService.sendBriefing(briefing.id);
          delivered = delivery.successCount > 0;
          message =
            delivery.targetCount === 0
              ? '简报未配置启用的投递目标'
              : `简报投递 ${delivery.successCount}/${delivery.targetCount}`;
        }

        if (delivered) {
          await this.recordSchedulerRun(feed.id, slot, message);
          this.logger.log(
            `Scheduled briefing delivered for feed ${feed.id} (${feed.project.name}/${feed.name}) at slot ${slot}: ${message}.`,
          );
        } else {
          await this.recordSchedulerRun(feed.id, null, message);
          this.logger.warn(
            `Scheduled briefing generated but not delivered for feed ${feed.id} (${feed.project.name}/${feed.name}) at slot ${slot}: ${message}.`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.recordSchedulerRun(feed.id, null, message);
        this.logger.warn(
          `Scheduled briefing failed for feed ${feed.id} (${feed.project.name}/${feed.name}) at slot ${slot}: ${message}`,
        );
      }
    }

    return { generatedCount };
  }

  private async recordSchedulerRun(feedId: string, slot: string | null, message: string) {
    await this.prisma.briefingFeed.update({
      where: { id: feedId },
      data: {
        lastSchedulerRunAt: new Date(),
        lastSchedulerMessage: message,
        ...(slot ? { lastSchedulerSlot: slot } : {}),
      },
    });
  }
}
