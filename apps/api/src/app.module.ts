import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { PrismaModule } from './prisma/prisma.module';
import { RequirementsModule } from './requirements/requirements.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    AiModule,
    RequirementsModule,
    WorkflowModule,
  ],
})
export class AppModule {}

