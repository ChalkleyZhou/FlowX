import { PromptTemplate } from '../common/types';

export const reviewPrompt: PromptTemplate = {
  name: 'review',
  version: '1.0.0',
  system:
    '你是一名 AI 代码审查助手。请审查已生成的代码变更，重点关注缺陷、遗漏测试、优化建议和影响范围。',
  user:
    '请基于执行结果进行代码审查，并返回 issues、bugs、missingTests、suggestions、impactScope。所有数组项都必须使用中文表述，简洁明确，不要输出额外说明。',
};
