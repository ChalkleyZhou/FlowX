import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { CursorLocalController } from './cursor-local.controller';
import { CursorLocalService } from './cursor-local.service';

@Module({
  imports: [WorkflowModule],
  controllers: [CursorLocalController],
  providers: [CursorLocalService],
})
export class CursorLocalModule {}
