import { AuthModule } from '../auth/auth.module';
import { LocalLaunchTicketStore } from '../workflow/local-launch-ticket.store';
import { QualityLocalLaunchController } from './quality-local-launch.controller';
import { QualityLocalLaunchService } from './quality-local-launch.service';
import { LocalTestRunsService } from './local-test-runs.service';
import { LocalTestRunsController } from './local-test-runs.controller';
import { TestReportsService } from './test-reports.service';
import { TestReportsController } from './test-reports.controller';
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
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { LocalSmokeController } from './local-smoke.controller';
import { LocalSmokeService } from './local-smoke.service';

@Module({
  imports: [PrismaModule, AiModule, ArtifactsModule, AuthModule],
  controllers: [
    QualityLocalLaunchController,
    CaseLibrariesController,
    TestRequestsController,
    TestRunsController,
    TestDesignsController,
    LocalSmokeController,
    LocalTestRunsController,
    TestReportsController,
  ],
  providers: [
    QualityLocalLaunchService,
    LocalLaunchTicketStore,
    CaseLibrariesService,
    TestRequestsService,
    TestRunsService,
    TestDesignsService,
    LocalSmokeService,
    LocalTestRunsService,
    TestReportsService,
  ],
  exports: [
    CaseLibrariesService,
    TestRequestsService,
    TestRunsService,
    TestDesignsService,
    LocalSmokeService,
    LocalTestRunsService,
    TestReportsService,
  ],
})
export class QualityModule {}
