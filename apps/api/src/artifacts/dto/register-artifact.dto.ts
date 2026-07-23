import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ARTIFACT_STATUSES,
  ARTIFACT_STORAGE_PROVIDERS,
  ARTIFACT_TYPES,
  type ArtifactStatus,
  type ArtifactStorageProvider,
  type ArtifactType,
} from '@flowx-ai/protocol';

export class RegisterArtifactDto {
  @IsIn(ARTIFACT_TYPES)
  artifactType!: ArtifactType;

  @IsString()
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @IsIn(ARTIFACT_STORAGE_PROVIDERS)
  storageProvider!: ArtifactStorageProvider;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  storageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  externalUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  byteSize?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  sha256?: string;

  @IsOptional()
  @IsIn(ARTIFACT_STATUSES)
  status?: ArtifactStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
