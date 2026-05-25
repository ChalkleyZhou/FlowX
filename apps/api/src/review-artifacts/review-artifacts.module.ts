import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { ReviewArtifactsController } from './review-artifacts.controller';
import { ReviewArtifactsService } from './review-artifacts.service';

@Module({
  imports: [WorkflowModule],
  controllers: [ReviewArtifactsController],
  providers: [ReviewArtifactsService],
  exports: [ReviewArtifactsService],
})
export class ReviewArtifactsModule {}
