import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class StartBugFixWorkflowDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['codex', 'cursor'])
  aiProvider?: string;

  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;
}
