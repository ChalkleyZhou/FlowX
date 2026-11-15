import { IsIn, IsOptional, IsString } from 'class-validator';

export class GenerateExecutionPlanDto {
  @IsOptional()
  @IsString()
  @IsIn(['codex', 'cursor'])
  aiProvider?: string;
}
