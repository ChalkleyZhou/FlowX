import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ScopeModuleStrategy } from '../test-request-scope-summary';

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

  @IsOptional()
  @IsString()
  testDesignId?: string;
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
  @IsOptional()
  @IsInt()
  @Min(0)
  scopeRevision?: number;

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

export class PrepareTestRequestDto {
  @IsInt()
  @Min(0)
  scopeRevision!: number;
}

export class UpdateTestRequestScopeDraftDto {
  @IsInt()
  @Min(0)
  scopeRevision!: number;

  @IsArray()
  @IsString({ each: true })
  removedCandidateIds!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  restoredCandidateIds?: string[];
}

export class UpdateTestScopeModuleDto extends PrepareTestRequestDto {
  @IsString()
  @MinLength(1)
  moduleId!: string;

  @IsBoolean()
  included!: boolean;

  @IsOptional()
  @IsIn(['AI_RECOMMENDED', 'ALL'])
  strategy?: ScopeModuleStrategy;
}

export class SaveGeneratedTestCaseDto {
  @IsString()
  @MinLength(1)
  libraryId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  moduleId?: string;
}

export class AssignTestRequestCasesDto {
  @IsInt()
  @Min(0)
  scopeRevision!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestRequestCaseAssignmentDto)
  assignments!: TestRequestCaseAssignmentDto[];
}

export class TestRequestCaseAssignmentDto {
  @IsString()
  @MinLength(1)
  snapshotId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  assignedToUserId?: string | null;
}

export class CompleteTestScopeDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  scopeRevision?: number;

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
