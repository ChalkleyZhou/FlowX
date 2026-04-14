import { describe, expect, it } from 'vitest';
import { WorkflowService } from './workflow.service';
import { WorkflowRunStatus } from '../common/enums';

function createService() {
  return new WorkflowService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { get: () => ({}) } as never,
  );
}

describe('WorkflowService plan normalization', () => {
  it('normalizes Cursor-style technical plan payloads into GeneratePlanOutput', () => {
    const service = createService();

    const normalized = (service as unknown as {
      normalizePlanOutput: (output: Record<string, unknown>) => {
        summary: string;
        implementationPlan: string[];
        filesToModify: string[];
        newFiles: string[];
        riskPoints: string[];
      };
    }).normalizePlanOutput({
      objective: '在登录成功后展示欢迎弹框',
      stages: [
        {
          name: '行为与挂载点设计',
          goals: ['确定展示时机', '确定频控策略'],
          implementationSteps: ['在 App.tsx 中挂载欢迎弹框'],
          filesToModify: ['apps/admin-app/src/App.tsx'],
          newFiles: [],
        },
        {
          name: '欢迎弹框组件实现',
          goals: ['实现欢迎弹框组件'],
          newFiles: ['apps/admin-app/src/components/welcome/WelcomeModal.tsx'],
        },
      ],
      riskPoints: ['频控策略需要和产品确认'],
    });

    expect(normalized.summary).toBe('在登录成功后展示欢迎弹框');
    expect(normalized.implementationPlan).toEqual([
      '行为与挂载点设计: 确定展示时机',
      '行为与挂载点设计: 确定频控策略',
      '行为与挂载点设计: 在 App.tsx 中挂载欢迎弹框',
      '欢迎弹框组件实现: 实现欢迎弹框组件',
    ]);
    expect(normalized.filesToModify).toEqual(['apps/admin-app/src/App.tsx']);
    expect(normalized.newFiles).toEqual(['apps/admin-app/src/components/welcome/WelcomeModal.tsx']);
    expect(normalized.riskPoints).toEqual(['频控策略需要和产品确认']);
  });
});

describe('WorkflowService plan path validation', () => {
  it('accepts new files whose nearest existing ancestor directory already exists', async () => {
    const service = createService();
    const repositories = [
      {
        name: 'ai-platform',
        localPath:
          '/Users/chalkley/workspace/FlowX/apps/api/.flowx-data/workflows/cmny2zzgz000720jjtqqsns8a/repositories/ai-platform-cmny2zzh',
      },
    ] as never;

    await expect(
      (service as unknown as {
        planPathExistsInRepositories: (
          value: string,
          repositories: unknown,
          allowParentDirectory: boolean,
        ) => Promise<boolean>;
      }).planPathExistsInRepositories(
        'apps/admin-app/src/components/welcome/WelcomeModal.tsx',
        repositories,
        true,
      ),
    ).resolves.toBe(true);
  });
});

describe('WorkflowService review-finding execution flow', () => {
  it('keeps the workflow in human review pending after fixing a finding', () => {
    const service = createService();

    const nextStatus = (service as unknown as {
      getExecutionCompletionTargetStatus: (triggerType?: string) => WorkflowRunStatus;
    }).getExecutionCompletionTargetStatus('review_finding_fix');

    expect(nextStatus).toBe(WorkflowRunStatus.HUMAN_REVIEW_PENDING);
  });

  it('sends regular execution runs back to review pending', () => {
    const service = createService();

    const nextStatus = (service as unknown as {
      getExecutionCompletionTargetStatus: (triggerType?: string) => WorkflowRunStatus;
    }).getExecutionCompletionTargetStatus();

    expect(nextStatus).toBe(WorkflowRunStatus.REVIEW_PENDING);
  });

  it('allows rerunning review from human review pending without extra feedback', () => {
    const service = createService();

    const canRunReview = (service as unknown as {
      canRunReviewFromStatus: (status: string) => boolean;
    }).canRunReviewFromStatus('HUMAN_REVIEW_PENDING');

    expect(canRunReview).toBe(true);
  });

  it('marks a review finding as fixed pending review after triggering repair', () => {
    const service = createService();

    const nextStatus = (service as unknown as {
      getReviewFindingStatusAfterFix: () => string;
    }).getReviewFindingStatusAfterFix();

    expect(nextStatus).toBe('FIXED_PENDING_REVIEW');
  });
});
