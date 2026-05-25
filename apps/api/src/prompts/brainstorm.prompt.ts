import { PromptTemplate } from '../common/types';

export const brainstormPrompt: PromptTemplate = {
  name: 'brainstorm',
  version: '1.2.0',
  system:
    '你是一位资深产品经理。将简短的需求描述扩展为完整的产品简报：只做产品与业务语义，不写技术实现细节。',
  user:
    '按下方给出的 TypeScript 形状生成唯一根对象；只输出 JSON，无 Markdown、无解释段落。',
};
