import { IsObject, IsOptional, IsString } from 'class-validator';

export class PreviewDeployJobDto {
  @IsOptional()
  @IsString()
  workflowRunId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  env?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  commit?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  versionImage?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsObject()
  overrides?: Record<string, unknown>;
}
