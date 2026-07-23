import { forwardRef, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { AuthModule } from '../auth/auth.module';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { LocalLaunchController } from './local-launch.controller';
import { LocalLaunchService } from './local-launch.service';
import { LocalLaunchTicketStore } from './local-launch-ticket.store';
import { WorkflowArtifactService } from './workflow-artifact.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowGitRemoteService } from './workflow-git-remote.service';
import { WorkflowService } from './workflow.service';

@Module({
  // ArtifactsModule imports ExecutionSessionsModule, which in turn imports this module (to call
  // WorkflowService.completeLocalExecutionBySession) — keep this edge lazy via forwardRef so the
  // three modules don't deadlock on a synchronous circular require at bootstrap.
  imports: [AiModule, forwardRef(() => ArtifactsModule), AuthModule, WorkspacesModule, NotificationsModule],
  controllers: [WorkflowController, LocalLaunchController],
  providers: [
    WorkflowService,
    WorkflowStateMachine,
    WorkflowArtifactService,
    WorkflowGitRemoteService,
    LocalLaunchTicketStore,
    LocalLaunchService,
  ],
  exports: [WorkflowService, LocalLaunchService],
})
export class WorkflowModule {}
