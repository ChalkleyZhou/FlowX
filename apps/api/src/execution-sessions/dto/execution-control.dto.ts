import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  EXECUTION_COMMAND_OUTCOMES, EXECUTION_COMMAND_TYPES, EXECUTION_SESSION_STATUSES, SOURCE_TOOLS,
  type ExecutionCommandOutcome, type ExecutionCommandType, type ExecutionSessionStatus, type SourceTool,
} from '@flowx-ai/protocol';

export class ListExecutionSessionsDto {
  @IsOptional() @IsString() @MaxLength(200) projectId?: string;
  @IsOptional() @IsString() @MaxLength(200) workflowRunId?: string;
  @IsOptional() @IsIn(EXECUTION_SESSION_STATUSES) status?: ExecutionSessionStatus;
  @IsOptional() @IsIn(SOURCE_TOOLS) sourceTool?: SourceTool;
  @IsOptional() @IsDateString() since?: string;
  @IsOptional() @IsDateString() until?: string;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}
export class RequestExecutionCommandDto {
  @IsIn(EXECUTION_COMMAND_TYPES) commandType!: ExecutionCommandType;
  @IsString() @IsNotEmpty() @MaxLength(200) idempotencyKey!: string;
}
export class ExecutionCheckpointDto {
  @IsString() @IsNotEmpty() @MaxLength(200) deviceId!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(2000) blockedReason?: string;
}
export class AcknowledgeExecutionCommandDto {
  @IsString() @IsNotEmpty() @MaxLength(200) deviceId!: string;
  @IsIn(EXECUTION_COMMAND_OUTCOMES) outcome!: ExecutionCommandOutcome;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
}

export class RetryExecutionSessionDto {
  @IsIn([true]) previousExecutionStopped!: true;
  @IsIn(['cursor', 'codex']) sourceTool!: 'cursor' | 'codex';
}
