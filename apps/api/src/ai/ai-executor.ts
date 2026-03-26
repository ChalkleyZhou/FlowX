import {
  ExecuteTaskInput,
  ExecuteTaskOutput,
  GeneratePlanInput,
  GeneratePlanOutput,
  ReviewCodeInput,
  ReviewCodeOutput,
  SplitTasksInput,
  SplitTasksOutput,
} from '../common/types';

export const AI_EXECUTOR = Symbol('AI_EXECUTOR');

export interface AIExecutor {
  splitTasks(input: SplitTasksInput): Promise<SplitTasksOutput>;
  generatePlan(input: GeneratePlanInput): Promise<GeneratePlanOutput>;
  executeTask(input: ExecuteTaskInput): Promise<ExecuteTaskOutput>;
  reviewCode(input: ReviewCodeInput): Promise<ReviewCodeOutput>;
}

