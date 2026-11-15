import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ExecutionItemActionDto {
  @IsString()
  @MaxLength(300)
  claimKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
