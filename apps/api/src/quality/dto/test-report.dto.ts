import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { LocalSmokeRevisionDto } from './local-smoke.dto';
export class CreateRunTestReportDto {
  @IsString() @MinLength(1) idempotencyKey!: string;
  @IsIn(['PROGRESS', 'FINAL']) mode!: 'PROGRESS' | 'FINAL';
}
export class QualitySupersessionDto {
  @IsString() @MinLength(1) previousRunId!: string;
  @IsString() @MinLength(1) regressionRunId!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) testRunCaseIds!: string[];
}
export class CreateRequestTestReportDto extends CreateRunTestReportDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) runIds!: string[];
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LocalSmokeRevisionDto) baseline!: LocalSmokeRevisionDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QualitySupersessionDto) supersessions?: QualitySupersessionDto[];
}
