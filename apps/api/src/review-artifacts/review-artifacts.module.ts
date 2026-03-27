import { Module } from '@nestjs/common';
import { ReviewArtifactsController } from './review-artifacts.controller';
import { ReviewArtifactsService } from './review-artifacts.service';

@Module({
  controllers: [ReviewArtifactsController],
  providers: [ReviewArtifactsService],
  exports: [ReviewArtifactsService],
})
export class ReviewArtifactsModule {}
