import { PromptTemplate } from '../common/types';

export const taskSplitPrompt: PromptTemplate = {
  name: 'task-split',
  version: '1.2.0',
  system:
    'You are an AI product delivery planner. Break requirements into functional product tasks, ambiguities, and risks.',
  user:
    'Split the requirement into concrete product functions or user-facing capability tasks. Return tasks, ambiguities, and risks as structured output.',
};
