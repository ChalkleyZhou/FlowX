import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { BriefingsModule } from './briefings/briefings.module';
import { CursorLocalModule } from './cursor-local/cursor-local.module';
import { DailyCodeReviewModule } from './daily-code-review/daily-code-review.module';
import { DeployModule } from './deploy/deploy.module';
import { DevPreviewModule } from './dev-preview/dev-preview.module';
import { ExecutionSessionsModule } from './execution-sessions/execution-sessions.module';
import { SessionAuthGuard } from './auth/session-auth.guard';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { ScheduleModule } from './schedule/schedule.module';
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
    BriefingsModule,
    CursorLocalModule,
    DailyCodeReviewModule,
    DeployModule,
    DevPreviewModule,
    ExecutionSessionsModule,
    ProjectsModule,
    ScheduleModule,
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
