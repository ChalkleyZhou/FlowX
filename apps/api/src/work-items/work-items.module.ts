import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkItemsController } from './work-items.controller';
import { WorkItemsService } from './work-items.service';

@Module({ imports: [AiModule, WorkflowModule], controllers: [WorkItemsController], providers: [WorkItemsService], exports: [WorkItemsService] })
export class WorkItemsModule {}
