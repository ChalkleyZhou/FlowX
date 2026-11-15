import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class StartLocalChatDto {
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
}
