import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRequirementChangeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content!: string;

  @IsIn(['SUPPLEMENT', 'RESTART'])
  mode!: 'SUPPLEMENT' | 'RESTART';

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  requestId!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sourceWorkflowRunId?: string;
}
