import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class FailExecutionSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  errorCode?: string;

  @IsString()
  @MaxLength(4000)
  errorMessage!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
