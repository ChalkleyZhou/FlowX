import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateCodeReviewSourceDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
