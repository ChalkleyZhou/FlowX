import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [AiModule],
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowStateMachine],
})
export class WorkflowModule {}
