import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBriefingSourceDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  repositoryId!: string;

  @IsInt()
  gitlabProjectId!: number;

  @IsString()
  @IsNotEmpty()
  pathWithNamespace!: string;

  @IsString()
  @IsNotEmpty()
  webhookSecret!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

