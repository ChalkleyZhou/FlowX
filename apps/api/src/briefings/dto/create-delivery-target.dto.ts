import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDeliveryTargetDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  userId?: string;

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

