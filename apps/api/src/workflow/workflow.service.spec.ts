import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiInvocationContextService } from '../ai/ai-invocation-context.service';
import type { AiCredentialsService } from '../auth/ai-credentials.service';
import { WorkflowRunStatus } from '../common/enums';
import { WorkflowService } from './workflow.service';

function createService() {
  return new WorkflowService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      normalizeAiProvider: (provider?: string | null) => {
        const candidate = provider?.trim().toLowerCase();
        if (candidate === 'cursor') {
          return 'cursor';
        }
        if (candidate === 'codex') {
          return 'codex';
        }
        return 'codex';
      },
      getConfiguredDefaultProvider: () => 'codex' as const,
      resolveInvocationContext: async () => ({}),
    } as never,
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

function createInvocationContextService(overrides?: {
  getCursorApiKeyForOrganization?: (organizationId: string) => Promise<string | null>;
  getCodexApiKeyForOrganization?: (organizationId: string) => Promise<string | null>;
}) {
  const aiCredentialsService = {
    getCursorApiKeyForOrganization: overrides?.getCursorApiKeyForOrganization ?? (async () => null),
    getCodexApiKeyForOrganization: overrides?.getCodexApiKeyForOrganization ?? (async () => null),
  } as AiCredentialsService;
  return new AiInvocationContextService(aiCredentialsService);
}

describe('WorkflowService cursor credential policy', () => {
  const originalRequireUserCredential = process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL;
  const originalRequireUserCodexCredential = process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL;
  const originalCursorApiKey = process.env.CURSOR_API_KEY;
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalRequireUserCredential === undefined) {
      delete process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL;
    } else {
      process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL = originalRequireUserCredential;
    }

    if (originalCursorApiKey === undefined) {
      delete process.env.CURSOR_API_KEY;
    } else {
      process.env.CURSOR_API_KEY = originalCursorApiKey;
    }

    if (originalRequireUserCodexCredential === undefined) {
      delete process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL;
    } else {
      process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL = originalRequireUserCodexCredential;
    }

    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
  });

  it('blocks cursor execution when user credential is required but missing', async () => {
    process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL = 'true';
    delete process.env.CURSOR_API_KEY;
    const service = createInvocationContextService({
      getCursorApiKeyForOrganization: async () => null,
    });

    await expect(
      service.resolveInvocationContext('cursor', { flowxUserId: 'user-1', displayName: 'User' }),
    ).rejects.toThrow(/CURSOR_ORGANIZATION_CREDENTIAL_REQUIRED/);
  });

  it('keeps compatibility fallback when strict mode is disabled', async () => {
    process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL = 'false';
    process.env.CURSOR_API_KEY = 'instance-key';
    const service = createInvocationContextService({
      getCursorApiKeyForOrganization: async () => null,
    });

    await expect(
      service.resolveInvocationContext('cursor', { flowxUserId: 'user-1', displayName: 'User' }),
    ).resolves.toMatchObject({
      cursorCredentialSource: 'instance',
    });
  });

  it('blocks codex execution when user credential is required but missing', async () => {
    process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL = 'true';
    delete process.env.OPENAI_API_KEY;
    const service = createInvocationContextService({
      getCursorApiKeyForOrganization: async () => null,
      getCodexApiKeyForOrganization: async () => null,
    });

    await expect(
      service.resolveInvocationContext('codex', { flowxUserId: 'user-1', displayName: 'User' }),
    ).rejects.toThrow(/CODEX_ORGANIZATION_CREDENTIAL_REQUIRED/);
  });

  it('uses codex organization credential before instance fallback', async () => {
    process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL = 'false';
    process.env.OPENAI_API_KEY = 'instance-openai-key';
    const service = createInvocationContextService({
      getCursorApiKeyForOrganization: async () => null,
      getCodexApiKeyForOrganization: async () => 'org-openai-key',
    });

    await expect(
      service.resolveInvocationContext('codex', {
        flowxUserId: 'user-1',
        flowxOrganizationId: 'org-1',
        displayName: 'User',
      }),
    ).resolves.toMatchObject({
      codexApiKey: 'org-openai-key',
      codexCredentialSource: 'organization',
    });
  });
});

describe('WorkflowService publish retry after partial failure', () => {
  const buildDoneWorkflow = () =>
    ({
      id: 'wf-1',
      status: 'DONE',
      requirement: {
        title: 'Improve publish flow',
      },
      reviewFindings: [],
      reviewReport: { bugs: [] },
      codeExecution: {
        changedFiles: ['apps/api/src/workflow/workflow.service.ts'],
      },
      plan: null,
      workflowRepositories: [
        {
          name: 'flowx',
          workingBranch: 'flowx/workflow-wf-1',
          localPath: '/tmp/flowx-workflow',
          status: 'READY',
          url: 'git@github.com:acme/flowx.git',
        },
      ],
    }) as never;

  it('pushes existing workflow commit when worktree is already clean', async () => {
    const service = createService();
    const workflow = buildDoneWorkflow();
    const expectedCommitMessage = (service as unknown as {
      buildWorkflowCommitMessage: (input: unknown) => string;
    }).buildWorkflowCommitMessage(workflow);
    const runGit = vi
      .spyOn(service as never, 'runGit' as never)
      .mockImplementation(async (args: string[]) => {
        if (args[0] === 'log') {
          return { stdout: expectedCommitMessage, stderr: '' };
        }
        if (args[0] === 'rev-parse') {
          return { stdout: 'abc123', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
    vi.spyOn(service as never, 'hasGitChanges' as never).mockResolvedValue(false);
    vi.spyOn(service as never, 'resolvePublishRemoteUrl' as never).mockResolvedValue(
      'git@github.com:acme/flowx.git',
    );
    vi.spyOn(service as never, 'remoteBranchExists' as never).mockResolvedValue(true);

    const result = await (service as unknown as { publishGitChanges: (id: string) => Promise<{
      message: string;
      repositories: Array<{ repository: string; branch: string }>;
    }> }).publishGitChanges('wf-1');

    expect(result.message).toBe(expectedCommitMessage);
    expect(result.repositories).toHaveLength(1);
    expect(runGit).toHaveBeenCalledWith(
      expect.arrayContaining(['push', '--set-upstream']),
      '/tmp/flowx-workflow',
    );
    expect(runGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['commit', '-m', expectedCommitMessage]),
      '/tmp/flowx-workflow',
    );
  });

  it('still reports no new changes when head commit is unrelated', async () => {
    const service = createService();
    const workflow = buildDoneWorkflow();
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
    vi.spyOn(service as never, 'hasGitChanges' as never).mockResolvedValue(false);
    vi.spyOn(service as never, 'runGit' as never).mockImplementation(async (args: string[]) => {
      if (args[0] === 'log') {
        return { stdout: 'chore: unrelated commit', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    await expect(
      (service as unknown as { publishGitChanges: (id: string) => Promise<unknown> }).publishGitChanges(
        'wf-1',
      ),
    ).rejects.toThrow('当前工作流没有新的代码改动可提交。');
  });
});
