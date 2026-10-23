import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { AiModule } from '../ai/ai.module';
import { PrototypeImportsController } from './prototype-imports.controller';
import { PrototypeImportsService } from './prototype-imports.service';

@Module({ imports: [AiModule, WorkflowModule], controllers: [PrototypeImportsController], providers: [PrototypeImportsService] })
export class PrototypeImportsModule {}
