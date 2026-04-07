import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateWorkflowRunDto {
  @IsString()
  @IsNotEmpty()
  requirementId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['codex', 'cursor'])
  aiProvider?: string;
}
