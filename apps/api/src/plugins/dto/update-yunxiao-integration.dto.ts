import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateYunxiaoIntegrationDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  yunxiaoOrganizationIdentifier?: string | null;
}
