import {
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { SOURCE_TOOLS, SYNC_EVENT_TYPES } from 'flowx-protocol';

export class AppendSyncEventDto {
  @IsString()
  @MaxLength(200)
  eventId!: string;

  @IsString()
  @MaxLength(20)
  schemaVersion!: string;

  @IsIn(SOURCE_TOOLS)
  sourceTool!: (typeof SOURCE_TOOLS)[number];

  @IsString()
  @MaxLength(200)
  traceId!: string;

  @IsString()
  @MaxLength(100)
  entityType!: string;

  @IsString()
  @MaxLength(200)
  entityId!: string;

  @IsIn(SYNC_EVENT_TYPES)
  eventType!: (typeof SYNC_EVENT_TYPES)[number];

  @IsDefined()
  payload!: unknown;

  @IsDateString()
  occurredAt!: string;

  @IsString()
  @MaxLength(300)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sequence?: number;
}
