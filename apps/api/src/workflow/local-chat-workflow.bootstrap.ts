export interface LocalChatRequirementPayload {
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export function buildLocalChatRequirementBootstrap(requirement: LocalChatRequirementPayload) {
  const title = requirement.title.trim();
  const description = requirement.description.trim();
  const acceptanceCriteria = requirement.acceptanceCriteria.trim();

  return {
    task: {
      title,
      description,
      surface: 'local_chat',
      repositoryNames: [] as string[],
    },
    plan: {
      summary: `本地 Chat 实现：${title}`,
      implementationPlan: [
        '在 FlowX 工作分支上完成最小实现。',
        acceptanceCriteria ? `验收：${acceptanceCriteria}` : '满足需求描述中的目标行为。',
      ],
      filesToModify: [] as string[],
      newFiles: [] as string[],
      riskPoints: ['保持改动范围与任务一致。'],
    },
  };
}
