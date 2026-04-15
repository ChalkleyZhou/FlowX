import {
  BrainstormInput,
  BrainstormOutput,
  ExecuteTaskInput,
  ExecuteTaskOutput,
  GenerateDesignInput,
  GenerateDesignOutput,
  GeneratePlanInput,
  GeneratePlanOutput,
  ReviewCodeInput,
  ReviewCodeOutput,
  SplitTasksInput,
  SplitTasksOutput,
} from '../common/types';

export const AI_EXECUTOR = Symbol('AI_EXECUTOR');
export const AI_EXECUTOR_REGISTRY = Symbol('AI_EXECUTOR_REGISTRY');

export type AIExecutorProvider = 'codex' | 'cursor';
export type CursorCredentialSource = 'organization' | 'instance' | 'login-state';
export type CodexCredentialSource = 'organization' | 'instance' | 'login-state';

export interface AIInvocationContext {
  requestUserId?: string;
  requestUserDisplayName?: string;
  cursorApiKey?: string;
  cursorCredentialSource?: CursorCredentialSource;
  codexApiKey?: string;
  codexCredentialSource?: CodexCredentialSource;
}

export interface AIExecutor {
  brainstorm(input: BrainstormInput, context?: AIInvocationContext): Promise<BrainstormOutput>;
  generateDesign(input: GenerateDesignInput, context?: AIInvocationContext): Promise<GenerateDesignOutput>;
  splitTasks(input: SplitTasksInput, context?: AIInvocationContext): Promise<SplitTasksOutput>;
  generatePlan(input: GeneratePlanInput, context?: AIInvocationContext): Promise<GeneratePlanOutput>;
  executeTask(input: ExecuteTaskInput, context?: AIInvocationContext): Promise<ExecuteTaskOutput>;
  reviewCode(input: ReviewCodeInput, context?: AIInvocationContext): Promise<ReviewCodeOutput>;
}

export interface AIExecutorRegistry {
  get(provider: AIExecutorProvider): AIExecutor;
  list(): AIExecutorProvider[];
}
