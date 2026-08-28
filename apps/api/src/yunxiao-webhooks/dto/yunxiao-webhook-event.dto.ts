import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class YunxiaoWebhookRecipientDto {
  @IsString()
  @IsOptional()
  @MaxLength(128)
  dingtalkUserId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  unionId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(320)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  account?: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  name?: string;
}

export class YunxiaoWebhookEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/\S/)
  eventId!: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => YunxiaoWebhookRecipientDto)
  recipient!: YunxiaoWebhookRecipientDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/\S/)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  @Matches(/\S/)
  markdown!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @IsOptional()
  @MaxLength(2_048)
  url?: string;
}
