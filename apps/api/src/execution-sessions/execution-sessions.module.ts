import { forwardRef, Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { ExecutionSessionsController } from './execution-sessions.controller';
import { ExecutionSessionsService } from './execution-sessions.service';
import { SyncEventsService } from './sync-events.service';

@Module({
  // WorkflowModule (via ArtifactsModule) already imports ExecutionSessionsModule, so this edge
  // must stay lazy via forwardRef to avoid a circular module-resolution failure at bootstrap.
  imports: [forwardRef(() => WorkflowModule)],
  controllers: [ExecutionSessionsController],
  providers: [ExecutionSessionsService, SyncEventsService],
  exports: [ExecutionSessionsService, SyncEventsService],
})
export class ExecutionSessionsModule {}
