import { Module } from '@nestjs/common';
import { AI_EXECUTOR } from './ai-executor';
import { CodexAiExecutor } from './codex-ai.executor';
import { MockAiExecutor } from './mock-ai.executor';

@Module({
  providers: [
    MockAiExecutor,
    CodexAiExecutor,
    {
      provide: AI_EXECUTOR,
      useFactory: (codexExecutor: CodexAiExecutor, mockExecutor: MockAiExecutor) => {
        const provider = process.env.AI_EXECUTOR_PROVIDER?.trim().toLowerCase() ?? 'codex';
        return provider === 'mock' ? mockExecutor : codexExecutor;
      },
      inject: [CodexAiExecutor, MockAiExecutor],
    },
  ],
  exports: [AI_EXECUTOR],
})
export class AiModule {}
