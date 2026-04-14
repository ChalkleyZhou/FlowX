import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DeployModule } from '../deploy/deploy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RequirementsController } from './requirements.controller';
import { RequirementsService } from './requirements.service';

@Module({
  imports: [PrismaModule, AiModule, DeployModule],
  controllers: [RequirementsController],
  providers: [RequirementsService],
  exports: [RequirementsService],
})
export class RequirementsModule {}
