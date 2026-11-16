import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const WORK_ITEM_KINDS = ['REQUIREMENT', 'ISSUE', 'BUG'] as const;
export const WORK_ITEM_SPLIT_MODES = ['AI', 'SINGLE', 'MANUAL'] as const;

export class CreateWorkItemDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  versionId?: string;

  @IsIn(WORK_ITEM_KINDS)
  kind!: (typeof WORK_ITEM_KINDS)[number];

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
  repositoryIds?: string[];

  @IsOptional()
  @IsIn(WORK_ITEM_SPLIT_MODES)
  splitMode?: (typeof WORK_ITEM_SPLIT_MODES)[number];
}
