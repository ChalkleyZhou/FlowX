import { StageType } from '../common/enums';

export type BugFixPayload = {
  title: string;
  description: string;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  reproductionSteps?: string[] | null;
};

export const BUG_FIX_SKIPPED_STAGES: StageType[] = [
  StageType.BRAINSTORM,
  StageType.DESIGN,
  StageType.DEMO,
  StageType.TASK_SPLIT,
  StageType.TECHNICAL_PLAN,
];

export function buildBugFixRequirementPayload(bug: BugFixPayload) {
  const reproduction = (bug.reproductionSteps ?? [])
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n');
  const description = [
    bug.description.trim(),
    reproduction ? `\n\n复现步骤:\n${reproduction}` : '',
    bug.actualBehavior?.trim() ? `\n\n实际行为: ${bug.actualBehavior.trim()}` : '',
  ]
    .filter(Boolean)
    .join('');

  return {
    title: `[BugFix] ${bug.title.trim()}`,
    description,
    acceptanceCriteria:
      bug.expectedBehavior?.trim() ?? '修复后缺陷不再复现，相关路径可正常使用。',
  };
}

export function buildBugFixTask(bug: BugFixPayload, repositoryNames: string[] = []) {
  const reproduction = (bug.reproductionSteps ?? [])
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n');
  const description = [
    bug.description.trim(),
    reproduction ? `\n复现步骤:\n${reproduction}` : '',
    bug.actualBehavior?.trim() ? `\n实际行为: ${bug.actualBehavior.trim()}` : '',
    bug.expectedBehavior?.trim() ? `\n预期行为: ${bug.expectedBehavior.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    title: bug.title.trim(),
    description,
    surface: 'bug_fix',
    repositoryNames,
  };
}

export function buildBugFixPlanContent(bug: BugFixPayload) {
  const summary = `修复缺陷：${bug.title.trim()}`;
  const implementationPlan = [
    '根据缺陷描述定位根因并在工作分支中最小化修复。',
    bug.expectedBehavior?.trim()
      ? `修复后应满足：${bug.expectedBehavior.trim()}`
      : '修复后应消除缺陷描述中的异常行为。',
  ];

  return {
    summary,
    implementationPlan,
    filesToModify: [] as string[],
    newFiles: [] as string[],
    riskPoints: ['请确保修复范围最小，避免引入无关变更。'],
  };
}

export function buildBugFixExecutionFeedback(bug: BugFixPayload) {
  const lines = [
    '请根据以下缺陷信息修复代码。仅在当前工作流工作分支中做最小必要改动。',
    `标题：${bug.title.trim()}`,
    `描述：${bug.description.trim()}`,
  ];
  if (bug.actualBehavior?.trim()) {
    lines.push(`实际行为：${bug.actualBehavior.trim()}`);
  }
  if (bug.expectedBehavior?.trim()) {
    lines.push(`预期行为：${bug.expectedBehavior.trim()}`);
  }
  if ((bug.reproductionSteps ?? []).length > 0) {
    lines.push(
      `复现步骤：${(bug.reproductionSteps ?? []).map((step, index) => `${index + 1}. ${step}`).join(' ')}`,
    );
  }
  lines.push('修复完成后更新执行结果；不要处理与缺陷无关的改进。');
  return lines.join('\n');
}
