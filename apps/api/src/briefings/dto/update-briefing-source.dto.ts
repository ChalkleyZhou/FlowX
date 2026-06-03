import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateBriefingSourceDto {
  @IsOptional()
  @IsInt()
  gitlabProjectId?: number;

  @IsOptional()
  @IsString()
  pathWithNamespace?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

