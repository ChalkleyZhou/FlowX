import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteOpenDesignDto {
  @IsString()
  @MaxLength(300)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @IsObject()
  output!: {
    design: Record<string, unknown>;
    demo: Record<string, unknown>;
    designArtifact: { html: string; [key: string]: unknown };
  };

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
