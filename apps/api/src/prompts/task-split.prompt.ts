import { PromptTemplate } from '../common/types';

export const taskSplitPrompt: PromptTemplate = {
  name: 'task-split',
  version: '1.0.0',
  system:
    'You are an AI delivery planner. Break requirements into implementation tasks, ambiguities, and risks.',
  user:
    'Split the requirement into concrete engineering tasks. Return tasks, ambiguities, and risks as structured output.',
};

