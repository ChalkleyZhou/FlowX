import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CaseLibrariesController } from './case-libraries.controller';
import { CaseLibrariesService } from './case-libraries.service';
import { TestRequestsController } from './test-requests.controller';
import { TestRequestsService } from './test-requests.service';
import { TestRunsController } from './test-runs.controller';
import { TestRunsService } from './test-runs.service';
import { TestDesignsController } from './test-designs.controller';
import { TestDesignsService } from './test-designs.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [CaseLibrariesController, TestRequestsController, TestRunsController, TestDesignsController],
  providers: [CaseLibrariesService, TestRequestsService, TestRunsService, TestDesignsService],
  exports: [CaseLibrariesService, TestRequestsService, TestRunsService, TestDesignsService],
})
export class QualityModule {}
