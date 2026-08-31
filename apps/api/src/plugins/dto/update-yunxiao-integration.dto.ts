import { IsBoolean } from 'class-validator';

export class UpdateYunxiaoIntegrationDto {
  @IsBoolean()
  enabled!: boolean;
}
