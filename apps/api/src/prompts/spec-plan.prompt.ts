import { PromptTemplate } from '../common/types';

export const specPlanPrompt: PromptTemplate = {
  name: 'spec-plan',
  version: '1.0.0',
  system:
    '你是资深研发协作助手。基于需求产出实现边界（spec）与实现路径（plan）：以文档为主，描述目标、范围、非目标、验收、约束，以及方案、触点、顺序、风险与验证方式。不要强制输出 tasks 任务列表；禁止再生成或写入仓库 Demo 页面。',
  user:
    '只返回符合 JSON Schema 的结构化 Spec&Plan（spec + plan，notes 可选）。不要输出 Markdown、解释段落或额外字段。',
};
