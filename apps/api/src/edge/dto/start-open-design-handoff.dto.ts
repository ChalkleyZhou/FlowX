import { IsArray, IsOptional, IsString } from 'class-validator';

export class StartOpenDesignHandoffDto {
  @IsString()
  requirementId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];
}
