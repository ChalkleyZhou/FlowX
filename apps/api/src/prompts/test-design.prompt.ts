import type { PromptTemplate } from '../common/types';
import testDesignOutputSchema from '../ai/test-design.output.schema.json';

export const testDesignPrompt: PromptTemplate = {
  name: 'test-design',
  version: '1.0.1',
  system: '你是资深测试设计师。只输出符合 JSON Schema 的测试设计 JSON。',
  user: `根据已确认的 PRD、设计方案、Spec & Plan 和现有用例，生成本次改动的测试设计。

要求：
0. sourceSummary 必须严格包含 summary（字符串）、sourceTypes（字符串数组）、notes（字符串数组）；coverageSummary 必须严格包含 functionalAreas、mainFlows、edgeCases、permissions、dataBoundaries、notes，这些字段全部是字符串数组；不要添加其他字段。
1. candidates 中每条候选只能使用 REUSE、OPTIMIZE、CREATE、EXCLUDE 之一。
2. 现有用例匹配必须说明 sourceDefinitionId、sourceVersion、matchScore 和 matchReason；低置信度不要强行复用。
   同等匹配质量下优先使用 libraryProjectId 等于当前项目的项目库用例，再考虑 Workspace 共享库。
3. 每条候选（包括 REUSE、OPTIMIZE、CREATE、EXCLUDE）都必须给出完整的 proposedCase，包含 title、priority、precondition、steps、expected、tags；不能只给差异片段或省略复用用例内容。
4. CREATE 的 sourceDefinitionId 和 sourceVersion 必须为 null；REUSE 和 OPTIMIZE 必须引用已有用例的真实 ID 和整数版本，同一来源用例最多出现一次。
5. smokeCases 只覆盖本次改动的最小关键链路，不要复制整套历史用例。
6. 找不到可靠覆盖时写入 uncoveredItems，不要虚构已覆盖。
7. 每条候选和冒烟用例的 title、expected 必须非空，steps 必须包含至少一条非空字符串，内容可直接交给测试人员执行。

输出契约（与 test-design.output.schema.json 使用同一份定义）：
只输出一个符合下列 JSON Schema 的 JSON 对象，不要添加 Markdown 围栏或说明文字。所有 required 字段必须保留；没有内容的数组使用 []，允许为空的字段使用 null。
${JSON.stringify(testDesignOutputSchema)}`,
};
