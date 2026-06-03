import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBriefingSourceDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  repositoryId!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  webhookSecret?: string;

  @IsOptional()
  @IsIn(['github', 'gitlab'])
  provider?: 'github' | 'gitlab';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  externalPath?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
