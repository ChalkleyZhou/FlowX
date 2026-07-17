import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildSchedulerAuthSession,
  resolveProjectOrganizationId,
} from '../briefings/briefing-auth-session';
import {
  formatBriefingDate,
  isBriefingSchedulerDue,
} from '../briefings/briefing-time-window';
import { DailyCodeReviewService } from './daily-code-review.service';

const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class CodeReviewSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CodeReviewSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyCodeReviewService: DailyCodeReviewService,
  ) {}

  onModuleInit() {
    if (process.env.FLOWX_CODE_REVIEW_SCHEDULER_DISABLED === 'true') {
      this.logger.warn(
        'Daily code review scheduler is disabled by FLOWX_CODE_REVIEW_SCHEDULER_DISABLED.',
      );
      return;
    }

    void this.runDueCodeReviews().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Daily code review scheduler failed: ${message}`);
    });

    this.timer = setInterval(() => {
      void this.runDueCodeReviews().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Daily code review scheduler failed: ${message}`);
      });
    }, SCHEDULER_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runDueCodeReviews(now = new Date()) {
    const configs = await this.prisma.projectCodeReviewConfig.findMany({
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
        const organizationId = await resolveProjectOrganizationId(this.prisma, config.projectId);
        const schedulerAuthSession = organizationId
          ? await buildSchedulerAuthSession(this.prisma, organizationId)
          : undefined;

        const codeReview = await this.dailyCodeReviewService.generateProjectDailyCodeReview(
          config.projectId,
          {
            date,
            regenerate: true,
          },
          schedulerAuthSession,
        );
        generatedCount += 1;

        let message = 'Code Review 已生成';
        let delivered = Boolean(codeReview.sentAt);
        if (codeReview.sentAt) {
          message = 'Code Review 已发送（跳过重复投递）';
        } else {
          const delivery = await this.dailyCodeReviewService.sendDailyCodeReview(codeReview.id);
          delivered = delivery.successCount > 0;
          message =
            delivery.targetCount === 0
              ? 'Code Review 未配置启用的投递目标'
              : `Code Review 投递 ${delivery.successCount}/${delivery.targetCount}`;
        }

        if (delivered) {
          await this.recordSchedulerRun(config.projectId, slot, message);
          this.logger.log(
            `Scheduled code review delivered for project ${config.projectId} (${config.project.name}) at slot ${slot}: ${message}.`,
          );
        } else {
          await this.recordSchedulerRun(config.projectId, null, message);
          this.logger.warn(
            `Scheduled code review generated but not delivered for project ${config.projectId} (${config.project.name}) at slot ${slot}: ${message}.`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.recordSchedulerRun(config.projectId, null, message);
        this.logger.warn(
          `Scheduled code review failed for project ${config.projectId} (${config.project.name}) at slot ${slot}: ${message}`,
        );
      }
    }

    return { generatedCount };
  }

  private async recordSchedulerRun(projectId: string, slot: string | null, message: string) {
    await this.prisma.projectCodeReviewConfig.update({
      where: { projectId },
      data: {
        lastSchedulerRunAt: new Date(),
        lastSchedulerMessage: message,
        ...(slot ? { lastSchedulerSlot: slot } : {}),
      },
    });
  }
}
