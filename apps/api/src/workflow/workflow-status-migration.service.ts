import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { migrateWorkflowStatuses } from './workflow-status-migration';

@Injectable()
export class WorkflowStatusMigrationService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowStatusMigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const updated = await migrateWorkflowStatuses(this.prisma);
    if (updated > 0) {
      this.logger.log(`Migrated ${updated} workflow run status/stage value(s) to SPEC_PLAN.`);
    }
  }
}
