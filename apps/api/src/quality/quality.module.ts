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
  imports: [PrismaModule, AiModule, ArtifactsModule],
  controllers: [
    CaseLibrariesController,
    TestRequestsController,
    TestRunsController,
    TestDesignsController,
    LocalSmokeController,
  ],
  providers: [
    CaseLibrariesService,
    TestRequestsService,
    TestRunsService,
    TestDesignsService,
    LocalSmokeService,
  ],
  exports: [
    CaseLibrariesService,
    TestRequestsService,
    TestRunsService,
    TestDesignsService,
    LocalSmokeService,
  ],
})
export class QualityModule {}
