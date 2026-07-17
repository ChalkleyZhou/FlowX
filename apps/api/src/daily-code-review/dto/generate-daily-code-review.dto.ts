import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class GenerateDailyCodeReviewDto {
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}
