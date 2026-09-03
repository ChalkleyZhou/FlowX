import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateCaseLibraryDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  projectId?: string;

  @IsString()
  @MinLength(1)
  name!: string;
}

export class CreateTestCaseModuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  parentId?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class TestCaseCoverageDto {
  @IsString()
  @IsIn(['REQUIREMENT', 'ACCEPTANCE_CRITERION', 'MODULE', 'API', 'FILE', 'COMPONENT', 'RISK'])
  targetType!: string;

  @IsString()
  @MinLength(1)
  targetKey!: string;

  @IsOptional()
  @IsString()
  @IsIn(['MANUAL', 'AI', 'HISTORICAL'])
  source?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;
}

export class CreateTestCaseDefinitionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  moduleId?: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  @IsIn(['P0', 'P1', 'P2', 'P3'])
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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseCoverageDto)
  coverageLinks?: TestCaseCoverageDto[];
}
