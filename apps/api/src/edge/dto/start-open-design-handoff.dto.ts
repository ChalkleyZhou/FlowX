import { IsArray, IsOptional, IsString } from 'class-validator';

export class StartOpenDesignHandoffDto {
  @IsString()
  workItemId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repositoryIds?: string[];
}
