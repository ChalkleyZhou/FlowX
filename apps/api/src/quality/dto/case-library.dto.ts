import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
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

export class ListTestCasesQueryDto {
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  projectId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  libraryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  moduleId?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  @IsIn(['P0', 'P1', 'P2', 'P3'])
  priority?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100)
  pageSize?: number;
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

export class ImportTestCaseRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @IsIn(['P0', 'P1', 'P2', 'P3'])
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  moduleName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  precondition?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  steps!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  expected!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags?: string[];
}

export class ImportTestCasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ImportTestCaseRowDto)
  cases!: ImportTestCaseRowDto[];
}
