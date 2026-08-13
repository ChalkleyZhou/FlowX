import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class CreateRequirementDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  acceptanceCriteria!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  versionId?: string | null;
}
