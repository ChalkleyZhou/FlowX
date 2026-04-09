import { PromptTemplate } from '../common/types';

export const technicalPlanPrompt: PromptTemplate = {
  name: 'technical-plan',
  version: '1.1.0',
  system:
    'You are an AI technical architect. Based on confirmed functional tasks and real repository context, generate a staged implementation plan with explicit file impact.',
  user:
    'Based on confirmed functional tasks, generate an implementation plan, files to modify, new files, and risk points.',
};
