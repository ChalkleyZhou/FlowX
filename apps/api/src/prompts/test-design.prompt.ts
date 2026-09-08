import type { PromptTemplate } from '../common/types';

export const testDesignPrompt: PromptTemplate = {
  name: 'test-design',
  version: '1.0.0',
  system: '你是资深测试设计师。只输出符合 JSON Schema 的测试设计 JSON。',
  user: `根据已确认的 PRD、设计方案、Spec & Plan 和现有用例，生成本次改动的测试设计。

要求：
1. candidates 中每条候选只能使用 REUSE、OPTIMIZE、CREATE、EXCLUDE 之一。
2. 现有用例匹配必须说明 sourceDefinitionId、sourceVersion、matchScore 和 matchReason；低置信度不要强行复用。
   同等匹配质量下优先使用 libraryProjectId 等于当前项目的项目库用例，再考虑 Workspace 共享库。
3. OPTIMIZE 必须给出完整的 proposedCase，不能只给差异片段。
4. CREATE 不能引用 sourceDefinitionId。
5. smokeCases 只覆盖本次改动的最小关键链路，不要复制整套历史用例。
6. 找不到可靠覆盖时写入 uncoveredItems，不要虚构已覆盖。
7. steps 必须是字符串数组，内容可直接交给测试人员执行。`,
};
