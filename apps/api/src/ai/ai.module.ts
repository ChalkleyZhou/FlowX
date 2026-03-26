import { Module } from '@nestjs/common';
import { AI_EXECUTOR } from './ai-executor';
import { MockAiExecutor } from './mock-ai.executor';

@Module({
  providers: [
    MockAiExecutor,
    {
      provide: AI_EXECUTOR,
      useExisting: MockAiExecutor,
    },
  ],
  exports: [AI_EXECUTOR],
})
export class AiModule {}

