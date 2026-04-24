import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DevPreviewModule } from '../dev-preview/dev-preview.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdeationRecoveryService } from './ideation-recovery.service';
import { IdeationSessionEventsRepository } from './ideation-session-events.repository';
import { RequirementsController } from './requirements.controller';
import { RequirementsService } from './requirements.service';

@Module({
  imports: [PrismaModule, AiModule, DevPreviewModule],
  controllers: [RequirementsController],
  providers: [RequirementsService, IdeationRecoveryService, IdeationSessionEventsRepository],
  exports: [RequirementsService],
})
export class RequirementsModule {}
