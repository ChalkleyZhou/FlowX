import { IsEnum } from 'class-validator';
import { HumanReviewDecision } from '../../common/enums';

export class HumanReviewDecisionDto {
  @IsEnum(HumanReviewDecision)
  decision!: HumanReviewDecision;
}

