type DeliveryStage = { id?: string; stage: string; status: string; attempt: number; input?: unknown; output: unknown };

/** 只沿最新开发尝试的显式来源继承交付范围，不跨越新 attempt 搜索历史交付。 */
export function codeDeliverySourceStage<T extends DeliveryStage>(stages: T[]): T | undefined {
  const latest = stages.filter((stage) => stage.stage === 'EXECUTION').sort((a, b) => b.attempt - a.attempt)[0];
  const hasDelivery = (stage: T | undefined) => stage?.stage === 'EXECUTION' && stage.status === 'COMPLETED' &&
    Array.isArray(asRecord(asRecord(stage.output)?.delivery)?.submissions);
  if (hasDelivery(latest)) return latest;
  const sourceId = asRecord(latest?.input)?.sourceDeliveryStageExecutionId;
  if (typeof sourceId !== 'string' || !sourceId) return undefined;
  return stages.find((stage) => stage.id === sourceId && hasDelivery(stage));
}

/** 以冻结交付选择审查和发布仓库，禁止读取旧执行尝试的工作副本。 */
export function codeDeliveryReviewRepositories<T extends { id: string; workingBranch: string; localPath: string | null }>(
  repositories: T[],
  stages: DeliveryStage[],
): T[] {
  const latest = stages.filter((stage) => stage.stage === 'EXECUTION').sort((a, b) => b.attempt - a.attempt)[0];
  const source = codeDeliverySourceStage(stages);
  const delivery = asRecord(asRecord(source?.output)?.delivery);
  if (latest?.status !== 'COMPLETED' || !Array.isArray(delivery?.submissions)) return repositories;
  return delivery.submissions.flatMap((value) => {
    const submission = asRecord(value);
    const repository = repositories.find((repo) => repo.id === submission?.workflowRepositoryId);
    if (!repository || typeof submission?.branch !== 'string') return [];
    return source === latest ? [{ ...repository, workingBranch: submission.branch, localPath: null }] : [repository];
  });
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
