import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import type { ArtifactStorageProvider, StoredArtifactInfo } from './artifact-storage.provider';
import { LocalArtifactStorageProvider } from './local-artifact-storage.provider';
import { OssArtifactStorageProvider } from './oss-artifact-storage.provider';

export type FileStorageProviderName = 'local' | 'oss';

@Injectable()
export class FileStorageService {
  private readonly providers: Record<FileStorageProviderName, ArtifactStorageProvider>;
  readonly defaultProviderName: FileStorageProviderName;

  constructor(
    private readonly local: LocalArtifactStorageProvider,
    @Optional() private readonly oss?: OssArtifactStorageProvider,
  ) {
    const configured = process.env.FLOWX_FILE_STORAGE_PROVIDER?.trim().toLowerCase() || 'local';
    if (configured !== 'local' && configured !== 'oss') {
      throw new BadRequestException({
        code: 'FILE_STORAGE_PROVIDER_INVALID',
        message: 'FLOWX_FILE_STORAGE_PROVIDER must be local or oss.',
      });
    }
    this.defaultProviderName = configured;
    this.providers = { local, oss: oss as ArtifactStorageProvider };
    if (configured === 'oss' && !oss) {
      throw new BadRequestException({
        code: 'OSS_STORAGE_CONFIG_INVALID',
        message: 'OSS storage provider is not available.',
      });
    }
  }

  providerFor(provider: string): ArtifactStorageProvider {
    if (provider !== 'local' && provider !== 'oss') {
      throw new BadRequestException({
        code: 'ARTIFACT_STORAGE_PROVIDER_UNSUPPORTED',
        message: `Artifact storage provider ${provider} is not supported by this instance.`,
      });
    }
    const resolved = this.providers[provider];
    if (!resolved) {
      throw new BadRequestException({
        code: 'ARTIFACT_STORAGE_PROVIDER_UNAVAILABLE',
        message: `Artifact storage provider ${provider} is not configured.`,
      });
    }
    return resolved;
  }

  defaultProvider(): ArtifactStorageProvider {
    return this.providerFor(this.defaultProviderName);
  }

  validateReference(provider: string, storageKey: string): void {
    const resolved = this.providerFor(provider);
    if (resolved.resolvePath) resolved.resolvePath(storageKey);
    else if ('toObjectKey' in resolved && typeof resolved.toObjectKey === 'function') resolved.toObjectKey(storageKey);
  }

  write(provider: string, storageKey: string, content: Buffer): Promise<StoredArtifactInfo> {
    return this.providerFor(provider).write(storageKey, content);
  }

  read(provider: string, storageKey: string): Promise<Buffer> {
    return this.providerFor(provider).read(storageKey);
  }

  stat(provider: string, storageKey: string): Promise<{ byteSize: number }> {
    return this.providerFor(provider).stat(storageKey);
  }
}
