import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BRIEFING_TIMEZONE,
  DEFAULT_BRIEFING_CUTOFF_HOUR,
} from '../briefings/briefing-time-window';
import { UpsertCodeReviewConfigDto } from './dto/upsert-code-review-config.dto';

const DEFAULT_DAILY_HOUR = DEFAULT_BRIEFING_CUTOFF_HOUR;

@Injectable()
export class CodeReviewConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getProjectConfig(projectId: string) {
    await this.ensureProjectExists(projectId);
    const config = await this.prisma.projectCodeReviewConfig.findUnique({
      where: { projectId },
    });

    return (
      config ?? {
        projectId,
        enabled: false,
        dailyHour: DEFAULT_DAILY_HOUR,
        timezone: BRIEFING_TIMEZONE,
        autoSend: false,
        lastSchedulerSlot: null,
        lastSchedulerRunAt: null,
        lastSchedulerMessage: null,
        createdAt: null,
        updatedAt: null,
      }
    );
  }

  async upsertProjectConfig(projectId: string, dto: UpsertCodeReviewConfigDto) {
    await this.ensureProjectExists(projectId);
    const updateData: {
      enabled?: boolean;
      dailyHour?: number;
      timezone: string;
      autoSend?: boolean;
      lastSchedulerSlot?: string | null;
    } = {
      timezone: dto.timezone ?? BRIEFING_TIMEZONE,
    };
    if (dto.enabled !== undefined) {
      updateData.enabled = dto.enabled;
      updateData.autoSend = dto.enabled;
    }
    if (dto.dailyHour !== undefined) {
      updateData.dailyHour = dto.dailyHour;
      updateData.lastSchedulerSlot = null;
    }
    if (dto.autoSend !== undefined) {
      updateData.autoSend = dto.autoSend;
    }

    return this.prisma.projectCodeReviewConfig.upsert({
      where: { projectId },
      create: {
        projectId,
        enabled: dto.enabled ?? false,
        dailyHour: dto.dailyHour ?? DEFAULT_DAILY_HOUR,
        timezone: dto.timezone ?? BRIEFING_TIMEZONE,
        autoSend: dto.autoSend ?? false,
      },
      update: updateData,
    });
  }

  private async ensureProjectExists(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
  }
}
