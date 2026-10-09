import { IsIn, IsOptional } from 'class-validator';
import { StageFeedbackDto } from './stage-feedback.dto';

export class ReviewRunDto {
  @IsOptional()
  @IsIn(['codex', 'cursor'])
  aiProvider?: 'codex' | 'cursor';
}

export class ReviewFeedbackDto extends StageFeedbackDto {
  @IsOptional()
  @IsIn(['codex', 'cursor'])
  aiProvider?: 'codex' | 'cursor';
}
