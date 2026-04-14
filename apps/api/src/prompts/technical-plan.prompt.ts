import { PromptTemplate } from '../common/types';

export const technicalPlanPrompt: PromptTemplate = {
  name: 'technical-plan',
  version: '1.2.0',
  system:
    'You are an AI technical architect. Based on confirmed functional tasks and real repository context, generate a strictly structured implementation plan with explicit file impact.',
  user:
    'Based on confirmed functional tasks, generate only the structured implementation plan fields required by the workflow: summary, implementationPlan, filesToModify, newFiles, and riskPoints.',
};
