import type { SpecPlanOutput } from '../common/types';

export interface LocalChatRequirementPayload {
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export function buildLocalChatRequirementBootstrap(requirement: LocalChatRequirementPayload) {
  const title = requirement.title.trim();
  const description = requirement.description.trim();
  const acceptanceCriteria = requirement.acceptanceCriteria.trim();

  const specPlan: SpecPlanOutput = {
    spec: {
      goal: title,
      scope: [description || title],
      nonGoals: [],
      acceptanceCriteria: [acceptanceCriteria || '满足需求描述中的目标行为。'],
      constraints: ['保持改动范围与任务一致。'],
    },
    plan: {
      approach: `本地 Chat 实现：${title}`,
      touchpoints: [],
      sequence: ['在 FlowX 工作分支上完成最小实现', '按验收标准自检'],
      risks: ['保持改动范围与任务一致。'],
      verification: [acceptanceCriteria || '满足需求描述中的目标行为。'],
    },
  };

  return { specPlan };
}
