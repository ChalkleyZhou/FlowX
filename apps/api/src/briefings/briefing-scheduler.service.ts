import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BriefingsService } from './briefings.service';

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
    this.timer = setInterval(() => {
      void this.runDueBriefings().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Project briefing scheduler failed: ${message}`);
      });
    }, 60 * 60 * 1000);
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
      if (!isDue(config.timezone, config.dailyHour, now)) {
        continue;
      }
      const date = formatDateForTimezone(now, config.timezone);
      const briefing = await this.briefingsService.generateProjectBriefing(config.projectId, {
        date,
      });
      generatedCount += 1;
      if (config.autoSend) {
        await this.briefingsService.sendBriefing(briefing.id);
      }
    }

    return { generatedCount };
  }
}

function isDue(timezone: string, dailyHour: number, now: Date) {
  const parts = localParts(now, timezone);
  return parts.hour === dailyHour;
}

function formatDateForTimezone(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(
    2,
    '0',
  )}`;
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
  };
}

