import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateRepositoryDeployConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
