import { IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  currentVersionId?: string | null;
}
