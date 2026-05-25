import { IsIn, IsOptional } from 'class-validator';
import { RequirementPlanningStatus, RequirementPriority } from '../../common/enums';

export class UpdateRequirementDto {
  @IsOptional()
  @IsIn(Object.values(RequirementPriority))
  priority?: RequirementPriority;

  @IsOptional()
  @IsIn(Object.values(RequirementPlanningStatus))
  planningStatus?: RequirementPlanningStatus;
}
