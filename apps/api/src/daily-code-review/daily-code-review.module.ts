import { forwardRef, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BriefingsModule } from '../briefings/briefings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CodeReviewConfigService } from './code-review-config.service';
import { CodeReviewSchedulerService } from './code-review-scheduler.service';
import { CodeReviewSourcesController } from './code-review-sources.controller';
import { CodeReviewSourcesService } from './code-review-sources.service';
import { DailyCodeReviewController } from './daily-code-review.controller';
import { DailyCodeReviewAiService } from './daily-code-review-ai.service';
import { DailyCodeReviewService } from './daily-code-review.service';

@Module({
  imports: [PrismaModule, AiModule, WorkspacesModule, forwardRef(() => BriefingsModule)],
  controllers: [DailyCodeReviewController, CodeReviewSourcesController],
  providers: [
    DailyCodeReviewAiService,
    DailyCodeReviewService,
    CodeReviewConfigService,
    CodeReviewSchedulerService,
    CodeReviewSourcesService,
  ],
  exports: [DailyCodeReviewService, CodeReviewConfigService, CodeReviewSourcesService],
})
export class DailyCodeReviewModule {}
