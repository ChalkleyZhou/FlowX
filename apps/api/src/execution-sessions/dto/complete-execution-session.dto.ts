import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CompleteLocalRepositoryDto } from '../../workflow/dto/complete-local-execution.dto';

/**
 * Body for `POST /execution-sessions/:id/complete` (design spec §6.2/§6.3). When `repositories`
 * is provided (non-empty), this mirrors `CompleteLocalExecutionDto`/`LocalCompletionReport` and
 * the request is routed through `WorkflowService.completeLocalExecutionBySession` (the
 * canonical `LocalCompletionCommand`). Without `repositories`, this stays the thin session
 * status transition it always was.
 */
export class CompleteExecutionSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompleteLocalRepositoryDto)
  repositories?: CompleteLocalRepositoryDto[];

  @IsOptional()
  @IsBoolean()
  pushed?: boolean;

  @IsOptional()
  @IsString()
  implementationSummary?: string;

  @IsOptional()
  @IsString()
  testResult?: string;

  @IsOptional()
  @IsString()
  diffSummary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  untrackedFiles?: string[];
}
