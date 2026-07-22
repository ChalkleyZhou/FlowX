import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteExecutionSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
