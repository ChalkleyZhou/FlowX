import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsObject,
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

export class QualityCaseSelectionDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  libraryIds!: string[];
  @IsOptional() @IsArray() @IsString({ each: true })
  moduleIds?: string[];
  @IsOptional() @IsArray() @IsIn(['P0', 'P1', 'P2', 'P3'], { each: true })
  priorities?: string[];
  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];
  @IsOptional() @IsArray() @IsString({ each: true })
  targetKeys?: string[];
}
export class UpdateQualitySelectionDto {
  @IsInt() @Min(1)
  revision!: number;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => QualityCaseSelectionDto)
  caseSelection!: QualityCaseSelectionDto;
}
export class AddQualityCandidatesDto {
  @IsInt() @Min(1)
  revision!: number;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  definitionIds!: string[];
}

export class CreateTestDesignDto {
  @IsOptional() @ValidateNested() @Type(() => QualityCaseSelectionDto)
  caseSelection?: QualityCaseSelectionDto;

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

export class TestDesignCaseDraftDto {
  @IsString() @MinLength(1)
  title!: string;

  @IsString()
  priority!: string;

  @IsOptional() @IsString()
  precondition?: string | null;

  @IsArray() @IsString({ each: true })
  steps!: string[];

  @IsString() @MinLength(1)
  expected!: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];

  @IsOptional() @IsString()
  testData?: string | null;

  @IsOptional() @IsArray() @IsString({ each: true })
  targetKeys?: string[];
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
  @IsObject()
  @ValidateNested()
  @Type(() => TestDesignCaseDraftDto)
  proposedCase?: TestDesignCaseDraftDto;
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
  @IsOptional()
  @IsBoolean()
  partial?: boolean;

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
