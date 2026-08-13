import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { RequirementPlanningStatus, RequirementPriority } from '../../common/enums';

export class UpdateRequirementDto {
  @IsOptional()
  @IsIn(Object.values(RequirementPriority))
  priority?: RequirementPriority;

  @IsOptional()
  @IsIn(Object.values(RequirementPlanningStatus))
  planningStatus?: RequirementPlanningStatus;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  versionId?: string | null;
}
