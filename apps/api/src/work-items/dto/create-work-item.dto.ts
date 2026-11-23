import { IsArray as LabelIsArray, IsString as LabelIsString, ValidateIf as LabelValidateIf } from 'class-validator';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const WORK_ITEM_KINDS = ['REQUIREMENT', 'ISSUE', 'BUG'] as const;
export const WORK_ITEM_STATUSES = ['ACTIVE', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'WONT_FIX', 'CONFIRMED', 'FIXING', 'FIXED', 'VERIFIED', 'DONE', 'FAILED', 'CANCELLED', 'ARCHIVED'] as const;
export const WORK_ITEM_SPLIT_MODES = ['AI', 'SINGLE', 'MANUAL'] as const;
export const WORK_ITEM_MEMBER_ROLES = ['PARTICIPANT', 'VERIFIER'] as const;

export class CreateWorkItemDto {
  @LabelValidateIf((_, value) => value !== undefined) @LabelIsArray() @LabelIsString({ each: true })
  labelIds?: string[];
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  versionId?: string;

  @IsIn(WORK_ITEM_KINDS)
  kind!: (typeof WORK_ITEM_KINDS)[number];

  @IsOptional()
  @IsIn(WORK_ITEM_STATUSES)
  status?: (typeof WORK_ITEM_STATUSES)[number];

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantUserIds?: string[];

  @IsOptional()
  @IsString()
  verifierUserId?: string;

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
  @IsArray()
  @IsString({ each: true })
  reproductionSteps?: string[];

  @IsOptional()
  @IsString()
  sourceProvider?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  affectedVersion?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];

  @IsOptional()
  @IsIn(WORK_ITEM_SPLIT_MODES)
  splitMode?: (typeof WORK_ITEM_SPLIT_MODES)[number];
}
