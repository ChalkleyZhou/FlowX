import { IsDateString, IsOptional } from 'class-validator';

export class HeartbeatExecutionSessionDto {
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
