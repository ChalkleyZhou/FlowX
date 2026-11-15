import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class StartEdgeHandoffDto {
  @IsString()
  @IsNotEmpty()
  executionItemId!: string;

  @IsString()
  @IsNotEmpty()
  claimKey!: string;

  @IsOptional()
  @IsString()
  @IsIn(['codex', 'cursor'])
  aiProvider?: 'codex' | 'cursor';

  @IsString()
  @IsIn(['cursor', 'codex'])
  sourceTool!: 'cursor' | 'codex';
}
