import { Type } from 'class-transformer';
import { IsInt, Min, Max, IsBooleanString, IsIn, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { RequirementAssignmentRole } from '../../common/enums';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ASSIGNMENT_ROLES = Object.values(RequirementAssignmentRole);

export class GetScheduleGanttDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
  @IsOptional() @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['requirement', 'member'])
  view?: 'requirement' | 'member';

  @IsOptional()
  @IsIn(['project', 'organization'])
  scope?: 'project' | 'organization';

  @ValidateIf((dto: GetScheduleGanttDto) => (dto.scope ?? 'project') === 'project')
  @IsString()
  projectId?: string;

  @Matches(DATE)
  from!: string;

  @Matches(DATE)
  to!: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsBooleanString()
  onlyMe?: string;

  @IsOptional()
  @IsString()
  requirementId?: string;

  @IsOptional()
  @IsIn(ASSIGNMENT_ROLES)
  role?: string;
}
