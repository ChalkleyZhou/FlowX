import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateWorkflowRunDto {
  @IsString()
  @IsNotEmpty()
  workItemId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['codex', 'cursor'])
  aiProvider?: string;

  /**
   * 执行计划策略：
   * - SINGLE：工作流级领取，适用于一个端侧执行项；
   * - AI：使用已经确认的 AI 拆解计划；
   * - MANUAL：使用已经确认的人工拆解计划。
   */
  @IsOptional()
  @IsString()
  @IsIn(['AI', 'SINGLE', 'MANUAL'])
  splitMode?: 'AI' | 'SINGLE' | 'MANUAL';
}
