import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { SessionAuthGuard } from './auth/session-auth.guard';
import { PrismaModule } from './prisma/prisma.module';
import { ReviewArtifactsModule } from './review-artifacts/review-artifacts.module';
import { RequirementsModule } from './requirements/requirements.module';
import { WorkflowModule } from './workflow/workflow.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    AiModule,
    AuthModule,
    ReviewArtifactsModule,
    WorkspacesModule,
    RequirementsModule,
    WorkflowModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
  ],
})
export class AppModule {}
