import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCodeReviewSourceDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  repositoryId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
