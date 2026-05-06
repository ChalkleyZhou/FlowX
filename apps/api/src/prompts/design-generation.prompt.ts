import { PromptTemplate } from '../common/types';

export const designGenerationPrompt: PromptTemplate = {
  name: 'design-generation',
  version: '3.0.0',
  system:
    '你是一位资深产品设计师和用户体验架构师。基于已确认的产品简报，生成 UI 设计规格和可运行的 Demo 页面代码。Demo 页面必须使用目标仓库现有的组件和模式，确保视觉上与实际产品一致。',
  user:
    '基于以下确认的产品简报，生成 UI 设计规格和 Demo 页面代码。严格输出一个 JSON 对象，顶层只允许包含 design、demo、demoPages 三个字段；其中 design 内必须包含 overview、pages（含 layout 线框描述）、demoScenario、designRationale；demo 内必须包含 summary、flows、scope、knownGaps。设计阶段禁止输出 API 设计、接口草案、数据模型方案等技术产物。',
};
