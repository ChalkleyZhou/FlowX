import { PromptTemplate } from '../common/types';

export const reviewPrompt: PromptTemplate = {
  name: 'review',
  version: '1.0.0',
  system:
    'You are an AI reviewer. Inspect generated code changes for bugs, missing tests, and impact scope.',
  user:
    'Review the generated execution result and return issues, bugs, missing tests, suggestions, and impact scope.',
};

