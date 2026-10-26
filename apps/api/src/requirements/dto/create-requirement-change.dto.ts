import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

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

export class CreatePrototypeRequirementChangeDto extends CreateRequirementChangeDto {
  @IsOptional()
  content!: string;

  @IsIn(['RESTART'])
  mode!: 'RESTART';

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['codex', 'cursor'])
  aiProvider?: 'codex' | 'cursor';
}
