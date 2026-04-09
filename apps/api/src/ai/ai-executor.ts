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

export interface AIExecutor {
  brainstorm(input: BrainstormInput): Promise<BrainstormOutput>;
  generateDesign(input: GenerateDesignInput): Promise<GenerateDesignOutput>;
  splitTasks(input: SplitTasksInput): Promise<SplitTasksOutput>;
  generatePlan(input: GeneratePlanInput): Promise<GeneratePlanOutput>;
  executeTask(input: ExecuteTaskInput): Promise<ExecuteTaskOutput>;
  reviewCode(input: ReviewCodeInput): Promise<ReviewCodeOutput>;
}

export interface AIExecutorRegistry {
  get(provider: AIExecutorProvider): AIExecutor;
  list(): AIExecutorProvider[];
}
