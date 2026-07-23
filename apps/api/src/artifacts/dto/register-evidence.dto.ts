import { IsDateString, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  EVIDENCE_STATUSES,
  EVIDENCE_TYPES,
  SOURCE_TOOLS,
  type EvidenceStatus,
  type EvidenceType,
  type SourceTool,
} from '@flowx-ai/protocol';

export class RegisterEvidenceDto {
  @IsIn(EVIDENCE_TYPES)
  evidenceType!: EvidenceType;

  @IsIn(SOURCE_TOOLS)
  sourceTool!: SourceTool;

  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @IsOptional()
  @IsIn(EVIDENCE_STATUSES)
  status?: EvidenceStatus;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  artifactId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
