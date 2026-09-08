import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateTestDesignDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsString()
  @MinLength(1)
  projectId!: string;

  @IsString()
  @MinLength(1)
  projectVersionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  requirementIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  workflowRunIds!: string[];

  @IsOptional()
  @IsString()
  changeSummary?: string;
}

export class UpdateTestDesignCandidateDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsIn(['REUSE', 'OPTIMIZE', 'CREATE', 'EXCLUDE'])
  action?: string;

  @IsOptional()
  @IsIn(['PENDING', 'ACCEPTED', 'REJECTED'])
  resolution?: string;

  @IsOptional()
  @IsNumber()
  matchScore?: number;

  @IsOptional()
  @IsString()
  decisionNote?: string;

  @IsOptional()
  proposedCase?: {
    title: string;
    priority: string;
    precondition?: string | null;
    steps: string[];
    expected: string;
    tags?: string[];
  };
}

export class SmokeCaseDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  precondition?: string;

  @IsArray()
  @IsString({ each: true })
  steps!: string[];

  @IsString()
  @MinLength(1)
  expected!: string;

  @IsBoolean()
  blocking!: boolean;

  @IsArray()
  @IsString({ each: true })
  coverageKeys!: string[];

  @IsIn(['PENDING', 'ACCEPTED', 'REJECTED'])
  resolution!: string;
}

export class UpdateTestDesignSmokeDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SmokeCaseDto)
  cases!: SmokeCaseDto[];

  @IsOptional()
  @IsString()
  noSmokeReason?: string;
}

export class ConfirmTestDesignDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CoverageCheckDto)
  coverageChecks!: CoverageCheckDto[];

  @IsArray()
  @IsString({ each: true })
  uncoveredItems!: string[];

  @IsOptional()
  @IsString()
  noCaseReason?: string;

  @IsOptional()
  @IsString()
  noSmokeReason?: string;
}

export class CoverageCheckDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsBoolean()
  passed!: boolean;

  @IsOptional()
  @IsString()
  detail?: string;
}
