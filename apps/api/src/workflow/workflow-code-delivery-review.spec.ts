import { describe, expect, it } from 'vitest';
import { codeDeliveryReviewRepositories, codeDeliverySourceStage } from './workflow-code-delivery-review';
describe('分支交付审查上下文', () => {
  const repositories = [{ id: 'web', workingBranch: 'old', localPath: '/old', contextSnapshot: { shared: true } }, { id: 'api', workingBranch: 'old-api', localPath: '/old-api' }];
  it('仅使用最新冻结交付所选仓库和分支，保留共享上下文但不传入旧checkout', () => {
    const result = codeDeliveryReviewRepositories(repositories, [{ stage: 'EXECUTION', status: 'COMPLETED', attempt: 2, output: { delivery: { submissions: [{ workflowRepositoryId: 'web', branch: 'feature/final' }] } } }]);
    expect(result).toEqual([{ id: 'web', workingBranch: 'feature/final', localPath: null, contextSnapshot: { shared: true } }]);
    expect(repositories[0].localPath).toBe('/old');
  });
  it('云端修复完成后继承冻结仓库范围并保留本次准备的工作副本', () => {
    const prepared = [{ ...repositories[0], workingBranch: 'feature/final', localPath: '/new-attempt/web' }, repositories[1]];
    const result = codeDeliveryReviewRepositories(prepared, [
      { id: 'cloud', stage: 'EXECUTION', status: 'COMPLETED', attempt: 3, input: { sourceDeliveryStageExecutionId: 'delivery' }, output: { patchSummary: 'fix' } },
      { id: 'delivery', stage: 'EXECUTION', status: 'COMPLETED', attempt: 2, output: { delivery: { submissions: [{ workflowRepositoryId: 'web', branch: 'feature/final' }] } } },
    ]);
    expect(result).toEqual([prepared[0]]);
  });
  it('旧LOCAL/CLOUD仍沿用原有仓库输入', () => {
    expect(codeDeliveryReviewRepositories(repositories, [])).toBe(repositories);
  });
  it.each(['PENDING', 'RUNNING', 'FAILED', 'COMPLETED'])('最新%s尝试没有显式来源时，不跨attempt继承历史冻结', (status) => {
    const stages = [
      { id: 'delivery', stage: 'EXECUTION', status: 'COMPLETED', attempt: 2, output: { delivery: { submissions: [{ workflowRepositoryId: 'web', branch: 'feature/final' }] } } },
      { id: 'fresh', stage: 'EXECUTION', status, attempt: 3, input: { executor: 'LOCAL' }, output: null },
    ];
    expect(codeDeliverySourceStage(stages)).toBeUndefined();
    expect(codeDeliveryReviewRepositories(repositories, stages)).toBe(repositories);
  });
});
