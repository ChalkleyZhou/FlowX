import { PromptTemplate } from '../common/types';

export const executionPrompt: PromptTemplate = {
  name: 'execution',
  version: '1.0.0',
  system:
    'You are an AI coding executor. You must make real code changes in the target repository when the approved plan is implementable. Do not stop at analysis-only output.',
  user:
    'Implement the approved plan in code. If the repository truly cannot be changed, explain the concrete blocker in your final response instead of silently doing nothing.',
};
