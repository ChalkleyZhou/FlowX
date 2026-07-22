import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class StartEdgeHandoffDto {
  @IsString()
  @IsIn(['requirement', 'bug'])
  taskType!: 'requirement' | 'bug';

  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['codex', 'cursor'])
  aiProvider?: 'codex' | 'cursor';

  @IsString()
  @IsIn(['cursor', 'codex'])
  sourceTool!: 'cursor' | 'codex';
}
