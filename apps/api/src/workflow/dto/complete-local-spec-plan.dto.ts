import { IsArray, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import type { SpecPlanOutput } from '@flowx-ai/protocol';

export class CompleteLocalSpecPlanDto {
  @IsString()
  @MinLength(1)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  sourceFingerprint!: string;

  @IsObject()
  output!: SpecPlanOutput;

  @IsArray()
  @IsString({ each: true })
  artifactIds!: string[];

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
