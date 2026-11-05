import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BriefingsModule } from '../briefings/briefings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CodeReviewFeedsService } from './code-review-feeds.service';
import { CodeReviewSchedulerService } from './code-review-scheduler.service';
import { DailyCodeReviewController } from './daily-code-review.controller';
import { DailyCodeReviewAiService } from './daily-code-review-ai.service';
import { DailyCodeReviewService } from './daily-code-review.service';

@Module({
  imports: [PrismaModule, AiModule, WorkspacesModule, BriefingsModule],
  controllers: [DailyCodeReviewController],
  providers: [
    DailyCodeReviewAiService,
    DailyCodeReviewService,
    CodeReviewFeedsService,
    CodeReviewSchedulerService,
  ],
  exports: [DailyCodeReviewService, CodeReviewFeedsService],
})
export class DailyCodeReviewModule {}
