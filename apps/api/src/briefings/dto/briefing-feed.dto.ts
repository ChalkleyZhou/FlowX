import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateBriefingFeedDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  dailyHour?: number;

  @IsOptional()
  @IsBoolean()
  autoSend?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deliveryTargetIds?: string[];
}

export class UpdateBriefingFeedDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  dailyHour?: number;

  @IsOptional()
  @IsBoolean()
  autoSend?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deliveryTargetIds?: string[];
}
