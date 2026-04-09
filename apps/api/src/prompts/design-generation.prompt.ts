import { PromptTemplate } from '../common/types';

export const designGenerationPrompt: PromptTemplate = {
  name: 'design-generation',
  version: '1.0.0',
  system:
    '你是一位资深产品设计师和用户体验架构师。基于已确认的产品简报，生成 UI 设计规格和 Demo 场景脚本。',
  user:
    '基于以下确认的产品简报，生成 UI 设计规格。输出 overview、pages（含 layout 线框描述）、demoScenario、dataModels、apiEndpoints、designRationale。',
};
