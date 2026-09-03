import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class TestRunCaseInputDto {
  @IsString()
  @MinLength(1)
  snapshotId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  assignedToUserId?: string;
}

export class CreateTestRunDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @IsIn(['INITIAL', 'REGRESSION'])
  runType?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sourceBugId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TestRunCaseInputDto)
  cases!: TestRunCaseInputDto[];
}

export class ReportTestResultDto {
  @IsString()
  @IsIn(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'])
  result!: string;

  @IsOptional()
  @IsString()
  actualResult?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MinLength(1)
  bugId?: string;
}
