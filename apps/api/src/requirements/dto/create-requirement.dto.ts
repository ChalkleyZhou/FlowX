import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { RequirementPriority } from '../../common/enums';

export class CreateRequirementDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsIn(Object.values(RequirementPriority))
  priority?: RequirementPriority;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  acceptanceCriteria?: string;

  @IsOptional()
  @IsString()
  functionalModule?: string;

  @IsOptional()
  @IsString()
  riskImpact?: string;

  @IsOptional()
  @IsString()
  productRequirementDocument?: string;

  @IsOptional()
  @IsString()
  remark?: string;

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
