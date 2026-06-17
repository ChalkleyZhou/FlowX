import { IsBoolean, IsDateString, IsIn, IsOptional } from 'class-validator';

export const BRIEFING_PERIODS = ['DAILY', 'WEEKLY'] as const;
export type BriefingPeriod = (typeof BRIEFING_PERIODS)[number];

export class GenerateBriefingDto {
  @IsOptional()
  @IsIn(BRIEFING_PERIODS)
  period?: BriefingPeriod;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}
