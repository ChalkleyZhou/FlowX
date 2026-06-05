import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class StartLocalChatDto {
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
  aiProvider?: string;
}
