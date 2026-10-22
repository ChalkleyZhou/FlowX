import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, Equals, IsArray, IsNotEmpty, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
export class SubmitCodeBranchDto {
  @IsString()
  @IsNotEmpty()
  workflowRepositoryId!: string;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  branch!: string;
}
export class CodeBranchSelectionDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @Matches(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
  headSha!: string;
}
export class ConfirmCodeDeliveryDto {
  @Equals(true)
  confirmed!: true;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((row: CodeBranchSelectionDto) => row.id)
  @ValidateNested({ each: true })
  @Type(() => CodeBranchSelectionDto)
  submissions!: CodeBranchSelectionDto[];
}
