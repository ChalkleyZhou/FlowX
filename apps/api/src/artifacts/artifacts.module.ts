import { Module } from '@nestjs/common';
import { ExecutionSessionsModule } from '../execution-sessions/execution-sessions.module';
import { ARTIFACT_STORAGE_PROVIDER } from './artifact-storage.provider';
import { FILE_STORAGE_SERVICE } from './artifact-storage.provider';
import { ArtifactsController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';
import { EvidenceService } from './evidence.service';
import { FileStorageService } from './file-storage.service';
import { LocalArtifactStorageProvider } from './local-artifact-storage.provider';
import { OssArtifactStorageProvider } from './oss-artifact-storage.provider';

@Module({
  imports: [ExecutionSessionsModule],
  controllers: [ArtifactsController],
  providers: [
    LocalArtifactStorageProvider,
    {
      provide: ARTIFACT_STORAGE_PROVIDER,
      useExisting: LocalArtifactStorageProvider,
    },
    {
      provide: OssArtifactStorageProvider,
      useFactory: () => {
        const provider = process.env.FLOWX_FILE_STORAGE_PROVIDER?.trim().toLowerCase() || 'local';
        return provider === 'oss' ? new OssArtifactStorageProvider() : undefined;
      },
    },
    FileStorageService,
    {
      provide: FILE_STORAGE_SERVICE,
      useExisting: FileStorageService,
    },
    ArtifactsService,
    EvidenceService,
  ],
  exports: [
    ARTIFACT_STORAGE_PROVIDER,
    FILE_STORAGE_SERVICE,
    LocalArtifactStorageProvider,
    OssArtifactStorageProvider,
    FileStorageService,
    ArtifactsService,
    EvidenceService,
  ],
})
export class ArtifactsModule {}
