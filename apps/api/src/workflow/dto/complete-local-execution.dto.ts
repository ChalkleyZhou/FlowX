import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CompleteLocalRepositoryDto {
  @IsString()
  @IsNotEmpty()
  workflowRepositoryId!: string;

  @IsString()
  @IsNotEmpty()
  headSha!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  changedFiles!: string[];

  @IsOptional()
  @IsString()
  patchSummary?: string;
}

export class CompleteLocalExecutionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  idempotencyKey?: string;

  @ValidateNested({ each: true })
  @Type(() => CompleteLocalRepositoryDto)
  @ArrayMinSize(1)
  repositories!: CompleteLocalRepositoryDto[];

  @IsBoolean()
  pushed!: boolean;

  @IsOptional()
  @IsString()
  implementationSummary?: string;

  @IsOptional()
  @IsString()
  testResult?: string;

  @IsOptional()
  @IsString()
  diffSummary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  untrackedFiles?: string[];
}
