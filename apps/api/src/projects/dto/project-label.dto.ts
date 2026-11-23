import { IsDateString, IsIn, IsString, ValidateIf } from 'class-validator';
import { PROJECT_LABEL_COLORS, type ProjectLabelColor } from '@flowx-ai/protocol';
export class CreateProjectLabelDto {
  @IsString() name!: string;
  @ValidateIf((_, value) => value !== undefined) @IsIn(PROJECT_LABEL_COLORS) color?: ProjectLabelColor;
}
export class UpdateProjectLabelDto {
  @ValidateIf((_, value) => value !== undefined) @IsString() name?: string;
  @ValidateIf((_, value) => value !== undefined) @IsIn(PROJECT_LABEL_COLORS) color?: ProjectLabelColor;
  @ValidateIf((_, value) => value !== undefined) @IsDateString() updatedAt?: string;
}
