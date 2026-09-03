import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { AuthModule } from './auth/auth.module';
import { BriefingsModule } from './briefings/briefings.module';
import { CursorLocalModule } from './cursor-local/cursor-local.module';
import { DailyCodeReviewModule } from './daily-code-review/daily-code-review.module';
import { DevPreviewModule } from './dev-preview/dev-preview.module';
import { ExecutionSessionsModule } from './execution-sessions/execution-sessions.module';
import { EdgeModule } from './edge/edge.module';
import { LocalInstallModule } from './local-install/local-install.module';
import { SessionAuthGuard } from './auth/session-auth.guard';
import { PrismaModule } from './prisma/prisma.module';
import { OrganizationScopeInterceptor } from './prisma/organization-scope.interceptor';
import { ProjectsModule } from './projects/projects.module';
import { QualityModule } from './quality/quality.module';
import { ScheduleModule } from './schedule/schedule.module';
import { ReviewArtifactsModule } from './review-artifacts/review-artifacts.module';
import { RequirementsModule } from './requirements/requirements.module';
import { WorkflowModule } from './workflow/workflow.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { PluginsModule } from './plugins/plugins.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    AiModule,
    ArtifactsModule,
    AuthModule,
    BriefingsModule,
    CursorLocalModule,
    DailyCodeReviewModule,
    DevPreviewModule,
    ExecutionSessionsModule,
    EdgeModule,
    LocalInstallModule,
    ProjectsModule,
    QualityModule,
    ScheduleModule,
    ReviewArtifactsModule,
    WorkspacesModule,
    RequirementsModule,
    WorkflowModule,
    PluginsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: OrganizationScopeInterceptor,
    },
  ],
})
export class AppModule {}
