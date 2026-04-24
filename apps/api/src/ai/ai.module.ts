import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AI_EXECUTOR, AI_EXECUTOR_REGISTRY, type AIExecutorProvider } from './ai-executor';
import { AiInvocationContextService, resolveConfiguredDefaultAiProviderFromEnv } from './ai-invocation-context.service';
import { CodexAiExecutor } from './codex-ai.executor';
import { CursorAiExecutor } from './cursor-ai.executor';
import { MockAiExecutor } from './mock-ai.executor';

@Module({
  imports: [AuthModule],
  providers: [
    MockAiExecutor,
    CodexAiExecutor,
    CursorAiExecutor,
    AiInvocationContextService,
    {
      provide: AI_EXECUTOR,
      useFactory: (registry: { get: (provider: AIExecutorProvider) => unknown }) => {
        const provider = resolveConfiguredDefaultAiProviderFromEnv();
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
  exports: [AI_EXECUTOR, AI_EXECUTOR_REGISTRY, AiInvocationContextService],
})
export class AiModule {}
