import { StageType } from '../common/enums';
import type { SpecPlanOutput } from '../common/types';

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
  StageType.SPEC_PLAN,
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

export function buildBugFixSpecPlan(bug: BugFixPayload): SpecPlanOutput {
  return {
    spec: {
      goal: `修复缺陷：${bug.title.trim()}`,
      scope: [bug.description.trim() || bug.title.trim()],
      nonGoals: ['无关重构'],
      acceptanceCriteria: [
        bug.expectedBehavior?.trim() || '缺陷复现路径关闭',
        '回归相关用例',
      ],
      constraints: [],
    },
    plan: {
      approach: '最小改动修复根因并补充验证',
      touchpoints: [],
      sequence: ['定位', '修复', '验证'],
      risks: ['请确保修复范围最小，避免引入无关变更。'],
      verification: ['按复现步骤确认已修复'],
    },
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
