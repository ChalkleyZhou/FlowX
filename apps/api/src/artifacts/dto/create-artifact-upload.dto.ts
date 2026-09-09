import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ARTIFACT_TYPES, type ArtifactType } from '@flowx-ai/protocol';

export const MAX_MANAGED_ARTIFACT_BYTES = 100 * 1024 * 1024;

export class CreateArtifactUploadDto {
  @IsIn(ARTIFACT_TYPES)
  artifactType!: ArtifactType;

  @IsString()
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mimeType?: string;

  @IsInt()
  @Min(0)
  @Max(MAX_MANAGED_ARTIFACT_BYTES)
  byteSize!: number;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  sha256!: string;
}
