import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ContextPackageService } from './context-package.service';
import { EdgeController } from './edge.controller';
import { EdgeHandoffService } from './edge-handoff.service';
import { EdgeTasksService } from './edge-tasks.service';
import { OpenDesignEdgeController } from './open-design-edge.controller';
import { OpenDesignEdgeService } from './open-design-edge.service';

@Module({
  imports: [AuthModule, WorkflowModule],
  controllers: [EdgeController, OpenDesignEdgeController],
  providers: [EdgeTasksService, ContextPackageService, EdgeHandoffService, OpenDesignEdgeService],
  exports: [EdgeTasksService, ContextPackageService, EdgeHandoffService, OpenDesignEdgeService],
})
export class EdgeModule {}
