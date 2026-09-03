import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CaseLibrariesController } from './case-libraries.controller';
import { CaseLibrariesService } from './case-libraries.service';
import { TestRequestsController } from './test-requests.controller';
import { TestRequestsService } from './test-requests.service';
import { TestRunsController } from './test-runs.controller';
import { TestRunsService } from './test-runs.service';

@Module({
  imports: [PrismaModule],
  controllers: [CaseLibrariesController, TestRequestsController, TestRunsController],
  providers: [CaseLibrariesService, TestRequestsService, TestRunsService],
  exports: [CaseLibrariesService, TestRequestsService, TestRunsService],
})
export class QualityModule {}
