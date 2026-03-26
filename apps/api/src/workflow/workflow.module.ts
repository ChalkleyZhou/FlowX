import { Module } from '@nestjs/common';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowStateMachine],
})
export class WorkflowModule {}

