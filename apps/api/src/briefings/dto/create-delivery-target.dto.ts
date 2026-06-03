import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDeliveryTargetDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

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
}

