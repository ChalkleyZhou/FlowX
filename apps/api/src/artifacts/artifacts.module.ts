import { Module } from '@nestjs/common';
import { ExecutionSessionsModule } from '../execution-sessions/execution-sessions.module';
import { ARTIFACT_STORAGE_PROVIDER } from './artifact-storage.provider';
import { ArtifactsController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';
import { EvidenceService } from './evidence.service';
import { LocalArtifactStorageProvider } from './local-artifact-storage.provider';

@Module({
  imports: [ExecutionSessionsModule],
  controllers: [ArtifactsController],
  providers: [
    LocalArtifactStorageProvider,
    {
      provide: ARTIFACT_STORAGE_PROVIDER,
      useExisting: LocalArtifactStorageProvider,
    },
    ArtifactsService,
    EvidenceService,
  ],
  exports: [
    ARTIFACT_STORAGE_PROVIDER,
    LocalArtifactStorageProvider,
    ArtifactsService,
    EvidenceService,
  ],
})
export class ArtifactsModule {}
