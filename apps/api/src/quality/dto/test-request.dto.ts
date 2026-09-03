import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateTestRequestDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsString()
  @MinLength(1)
  projectId!: string;

  @IsString()
  @MinLength(1)
  projectVersionId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  requirementIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  workflowRunIds!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  artifactIds?: string[];
}

export class TestCaseSelectionDto {
  @IsString()
  @MinLength(1)
  caseId!: string;

  @IsString()
  @MinLength(1)
  reason!: string;

  @IsString()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  impactLevel!: string;
}

export class AddTestScopeCasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TestCaseSelectionDto)
  selections!: TestCaseSelectionDto[];
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

export class CompleteTestScopeDto {
  @IsString()
  @MinLength(1)
  summary!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CoverageCheckDto)
  coverageChecks!: CoverageCheckDto[];

  @IsArray()
  @IsString({ each: true })
  excludedScopes!: string[];
}
