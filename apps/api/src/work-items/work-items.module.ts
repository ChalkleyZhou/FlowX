import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkItemsController } from './work-items.controller';
import { WorkItemsService } from './work-items.service';

@Module({ imports: [AiModule, NotificationsModule, WorkflowModule], controllers: [WorkItemsController], providers: [WorkItemsService], exports: [WorkItemsService] })
export class WorkItemsModule {}
