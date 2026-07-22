import { Module } from '@nestjs/common';
import { ExecutionSessionsController } from './execution-sessions.controller';
import { ExecutionSessionsService } from './execution-sessions.service';
import { SyncEventsService } from './sync-events.service';

@Module({
  controllers: [ExecutionSessionsController],
  providers: [ExecutionSessionsService, SyncEventsService],
  exports: [ExecutionSessionsService, SyncEventsService],
})
export class ExecutionSessionsModule {}
