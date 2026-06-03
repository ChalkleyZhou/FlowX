import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateBriefingSourceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  webhookSecret?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
