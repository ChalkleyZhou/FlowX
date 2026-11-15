import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class StartWorkItemWorkflowDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['codex', 'cursor'])
  aiProvider?: string;

  @IsOptional()
  @IsString()
  @IsIn(['AI', 'SINGLE', 'MANUAL'])
  splitMode?: 'AI' | 'SINGLE' | 'MANUAL';
}
