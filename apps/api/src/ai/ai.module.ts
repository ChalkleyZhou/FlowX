import { Module } from '@nestjs/common';
import { AI_EXECUTOR, AI_EXECUTOR_REGISTRY, type AIExecutorProvider } from './ai-executor';
import { CodexAiExecutor } from './codex-ai.executor';
import { CursorAiExecutor } from './cursor-ai.executor';
import { MockAiExecutor } from './mock-ai.executor';

@Module({
  providers: [
    MockAiExecutor,
    CodexAiExecutor,
    CursorAiExecutor,
    {
      provide: AI_EXECUTOR,
      useFactory: (registry: { get: (provider: AIExecutorProvider) => unknown }) => {
        const provider = (process.env.AI_EXECUTOR_PROVIDER?.trim().toLowerCase() ?? 'codex') as AIExecutorProvider;
        return registry.get(provider);
      },
      inject: [AI_EXECUTOR_REGISTRY],
    },
    {
      provide: AI_EXECUTOR_REGISTRY,
      useFactory: (
        codexExecutor: CodexAiExecutor,
        cursorExecutor: CursorAiExecutor,
        mockExecutor: MockAiExecutor,
      ) => ({
        get: (provider: AIExecutorProvider) => {
          if (provider === 'cursor') {
            return cursorExecutor;
          }
          if (provider === 'codex') {
            return codexExecutor;
          }
          return mockExecutor;
        },
        list: () => ['codex', 'cursor'] as AIExecutorProvider[],
      }),
      inject: [CodexAiExecutor, CursorAiExecutor, MockAiExecutor],
    },
  ],
  exports: [AI_EXECUTOR, AI_EXECUTOR_REGISTRY],
})
export class AiModule {}
