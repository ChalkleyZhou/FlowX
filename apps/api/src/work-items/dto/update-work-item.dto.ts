import { IsArray as LabelIsArray, IsString as LabelIsString, ValidateIf as LabelValidateIf } from 'class-validator';
import { IsArray, IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { WORK_ITEM_STATUSES } from './create-work-item.dto';

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
  @IsIn(WORK_ITEM_STATUSES)
  status?: (typeof WORK_ITEM_STATUSES)[number];

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
  @IsArray()
  @IsString({ each: true })
  reproductionSteps?: string[];

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantUserIds?: string[];

  @IsOptional()
  @IsString()
  verifierUserId?: string | null;

  @IsOptional()
  @IsString()
  versionId?: string | null;

  @IsOptional()
  @IsDateString()
  updatedAt?: string;
}
