import { forwardRef, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BriefingsModule } from '../briefings/briefings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DailyCodeReviewController } from './daily-code-review.controller';
import { DailyCodeReviewAiService } from './daily-code-review-ai.service';
import { DailyCodeReviewService } from './daily-code-review.service';

@Module({
  imports: [PrismaModule, AiModule, WorkspacesModule, forwardRef(() => BriefingsModule)],
  controllers: [DailyCodeReviewController],
  providers: [DailyCodeReviewAiService, DailyCodeReviewService],
  exports: [DailyCodeReviewService],
})
export class DailyCodeReviewModule {}
