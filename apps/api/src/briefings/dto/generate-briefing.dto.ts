import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class GenerateBriefingDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}

