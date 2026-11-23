import { IsArray as LabelIsArray, IsString as LabelIsString, ValidateIf as LabelValidateIf } from 'class-validator';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateWorkItemDto {
  @LabelValidateIf((_, value) => value !== undefined) @LabelIsArray() @LabelIsString({ each: true })
  labelIds?: string[];
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

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
  planningStatus?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  expectedBehavior?: string;

  @IsOptional()
  @IsString()
  actualBehavior?: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string | null;

  @IsOptional()
  @IsString()
  versionId?: string | null;

  @IsOptional()
  @IsDateString()
  updatedAt?: string;
}
