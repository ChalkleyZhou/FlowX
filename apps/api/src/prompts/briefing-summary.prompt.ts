import type { BriefingFactsPayload } from '../briefings/briefing-facts';

export function buildBriefingSummaryPrompt(facts: BriefingFactsPayload) {
  const factsJson = JSON.stringify(facts, null, 2);

  return [
    '你是一位研发负责人助理，需要根据一天的研发活动事实，撰写面向管理层的「研发日报」摘要。',
    '',
    '要求：',
    '1. 只根据下方 JSON 事实归纳，不要编造未出现的仓库、功能或问题。',
    '2. 将相近提交/MR 合并为一条可读条目；用中文表述业务价值，避免堆砌 commit hash。',
    '3. features 写 feat 类新能力；fixes 写 fix 类缺陷修复；commits 中的 category 字段遵循 Conventional Commits（feat/fix/docs/chore/refactor 等）。',
    '4. 失败流水线、未合并阻塞项写入 risks；发布/标签及非功能类说明可写入 otherNotes（docs/chore 等已在提交附录中按类型列出，勿重复堆砌）。',
    '5. 若事实很少，如实说明「活动较少」并给出可能原因（如无推送、仅配置变更）。',
    '6. 输出必须符合 JSON Schema（由 CLI 校验），不要输出 Markdown 或额外说明。',
    '',
    `日期：${facts.date}`,
    `项目：${facts.projectName}`,
    '',
    '事实数据：',
    factsJson,
  ].join('\n');
}
