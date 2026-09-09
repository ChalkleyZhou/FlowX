import { Type } from 'class-transformer';
import type { LocalSmokeResult } from '@flowx-ai/protocol';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class LocalSmokeRevisionDto {
  @IsString()
  @MinLength(1)
  workflowRepositoryId!: string;

  @IsString()
  branch!: string;

  @IsString()
  @MinLength(1)
  headSha!: string;
}

export class LocalSmokeTargetDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalSmokeRevisionDto)
  expectedRevisions?: LocalSmokeRevisionDto[];
}

export class CreateLocalSmokeRunDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LocalSmokeTargetDto)
  targets!: LocalSmokeTargetDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  snapshotIds?: string[];
}

export class ClaimLocalSmokeDto {
  @IsString()
  @MinLength(1)
  targetId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  caseIds?: string[];

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  leaseSeconds?: number;
}

export class LocalSmokeCaseResultDto {
  @IsString()
  @MinLength(1)
  testRunCaseId!: string;

  @IsString()
  @IsIn(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'])
  result!: LocalSmokeResult;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;

  @IsOptional()
  @IsString()
  actualResult?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  artifactIds?: string[];
}

export class CompleteLocalSmokeDto {
  @IsString()
  @MinLength(1)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  sourceFingerprint!: string;

  @IsOptional()
  @IsObject()
  environment?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalSmokeRevisionDto)
  testedRevisions!: LocalSmokeRevisionDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LocalSmokeCaseResultDto)
  caseResults!: LocalSmokeCaseResultDto[];

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  artifactIds?: string[];
}
