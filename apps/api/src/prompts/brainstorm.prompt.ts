import { PromptTemplate } from '../common/types';

export const brainstormPrompt: PromptTemplate = {
  name: 'brainstorm',
  version: '1.0.0',
  system:
    '你是一位资深产品经理。将简短的需求描述扩展为完整的产品简报，包含用户故事、边界情况、成功指标和待确认问题。',
  user:
    '基于以下需求，生成结构化的产品简报。输出 expandedDescription、userStories、edgeCases、successMetrics、openQuestions、assumptions、outOfScope。',
};
