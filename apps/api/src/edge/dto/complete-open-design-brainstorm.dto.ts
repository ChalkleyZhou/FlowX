import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CompleteOpenDesignBrainstormDto {
  @IsString()
  @MaxLength(300)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  markdown!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
