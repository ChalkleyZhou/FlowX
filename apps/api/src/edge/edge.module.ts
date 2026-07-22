import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { ContextPackageService } from './context-package.service';
import { EdgeController } from './edge.controller';
import { EdgeHandoffService } from './edge-handoff.service';
import { EdgeTasksService } from './edge-tasks.service';

@Module({
  imports: [WorkflowModule],
  controllers: [EdgeController],
  providers: [EdgeTasksService, ContextPackageService, EdgeHandoffService],
  exports: [EdgeTasksService, ContextPackageService, EdgeHandoffService],
})
export class EdgeModule {}
