import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateBugDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string;

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
  repositoryId?: string;

  @IsOptional()
  @IsString()
  branchName?: string;
}
