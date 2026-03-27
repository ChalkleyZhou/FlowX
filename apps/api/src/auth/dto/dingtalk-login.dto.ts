import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DingTalkLoginDto {
  @IsString()
  @IsNotEmpty()
  callbackUrl!: string;

  @IsOptional()
  @IsString()
  next?: string;
}
