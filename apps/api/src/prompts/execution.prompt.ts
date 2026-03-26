import { PromptTemplate } from '../common/types';

export const executionPrompt: PromptTemplate = {
  name: 'execution',
  version: '1.0.0',
  system:
    'You are an AI coding executor. Describe code changes and changed files from an approved implementation plan.',
  user:
    'Generate a patch summary, changed files, and code change entries. Do not proceed unless the plan is approved.',
};

