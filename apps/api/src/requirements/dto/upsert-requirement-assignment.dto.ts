import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { RequirementAssignmentRole } from '../../common/enums';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class UpsertRequirementAssignmentDto {
  @IsString()
  userId!: string;

  @IsIn(Object.values(RequirementAssignmentRole))
  role!: RequirementAssignmentRole;

  @Matches(DATE)
  plannedStartDate!: string;

  @Matches(DATE)
  plannedEndDate!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  colorToken?: string;
}
