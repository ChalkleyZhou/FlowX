import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { LocalLaunchService } from './local-launch.service';
import { LocalLaunchTicketStore } from './local-launch-ticket.store';
import { WorkflowArtifactService } from './workflow-artifact.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowGitRemoteService } from './workflow-git-remote.service';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [AiModule, AuthModule, WorkspacesModule, NotificationsModule],
  controllers: [WorkflowController],
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
