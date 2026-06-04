import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class GenerateBriefingDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}

