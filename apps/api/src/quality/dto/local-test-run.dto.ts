import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { CompleteLocalSmokeDto, LocalSmokeTargetDto } from './local-smoke.dto';
export class LocalTestCaseMappingDto {
  @IsString() @MinLength(1) snapshotId!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) targetKeys!: string[];
}
export class CreateLocalTestRunDto {
  @IsString() @MinLength(1) name!: string;
  @IsIn(['INITIAL', 'REGRESSION']) runType!: 'INITIAL' | 'REGRESSION';
  @IsOptional() @IsString() @MinLength(1) sourceBugId?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LocalSmokeTargetDto) targets!: LocalSmokeTargetDto[];
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LocalTestCaseMappingDto) cases!: LocalTestCaseMappingDto[];
}
export class QualityExecutionReportDto extends CompleteLocalSmokeDto {
  @IsInt() @Min(0) testRunRevision!: number;
}
export class QualityControlDto {
  @IsOptional() @IsInt() @Min(60) leaseSeconds?: number;
  @IsOptional() @IsString() reason?: string;
}
export class FinishQualityRunDto {
  @IsInt() @Min(0) revision!: number;
  @IsOptional() @IsString() reason?: string;
}

export class LinkQualityBugDto {
  @IsString() @MinLength(1) bugId!: string;
}
