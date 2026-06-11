import type { BriefingFactsPayload } from '../briefings/briefing-facts';

export function buildBriefingSummaryPrompt(facts: BriefingFactsPayload) {
  const factsJson = JSON.stringify(facts, null, 2);

  return [
    '你需要把一天的 commit 整理成产品、测试和研发都能理解的「项目变化简报」。',
    '',
    '要求：',
    '1. commit 是唯一事实来源。只能整理、合并和改写下方 JSON，不能补充未出现的业务背景、用户对象或结论。',
    '2. 将明确描述同一变化的 commits 聚合成一个 topic；仅类型相同不能作为聚合依据。',
    '3. 每个 topic 必须引用至少一个真实 commit，repository 与 commitId 必须逐字使用事实数据中的值。',
    '4. modules 只能使用关联 commits 中明确出现的 repository 或 scope；无法确认时返回空数组。',
    '5. 信息量低、无法形成可靠项目变化的 commit 可以不进入 topics，它仍会出现在研发记录附录。',
    '6. 缺失的信息写入 openQuestions，只说明缺少什么，不猜测答案；没有待确认内容时返回空数组。',
    '7. 禁止宣称可测试、已上线、已发布、已验收，禁止生成验证建议、潜在风险、排期影响、用户反馈或虚构业务价值。',
    '8. headline 和 summaryParagraph 只概括可由 topics 支持的变化；topics 为空时应保守说明无法可靠归纳。',
    '9. 输出必须符合 JSON Schema（由 CLI 校验），不要输出 Markdown 或额外说明。',
    '',
    `日期：${facts.date}`,
    `项目：${facts.projectName}`,
    '',
    '事实数据：',
    factsJson,
  ].join('\n');
}
