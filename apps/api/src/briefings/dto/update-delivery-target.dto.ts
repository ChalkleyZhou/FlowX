import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateDeliveryTargetDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  emailAddress?: string;

  @IsOptional()
  @IsString()
  dingtalkWebhookUrl?: string;

  @IsOptional()
  @IsString()
  dingtalkSecret?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  forBriefing?: boolean;

  @IsOptional()
  @IsBoolean()
  forCodeReview?: boolean;
}

