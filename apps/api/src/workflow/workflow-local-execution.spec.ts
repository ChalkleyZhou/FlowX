import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { GeneratePlanOutput } from '../common/types';
import { WorkflowArtifactService } from './workflow-artifact.service';
import { WorkflowGitRemoteService } from './workflow-git-remote.service';
import { buildExecutionOutputFromLocalReport } from './workflow-local-execution-output';
import { WorkflowService } from './workflow.service';

const confirmedPlan: GeneratePlanOutput = {
  summary: 'Plan summary',
  implementationPlan: ['step'],
  filesToModify: ['src/App.tsx'],
  newFiles: [],
  riskPoints: [],
};

function createLocalExecutionService(prisma: Record<string, unknown> = {}) {
  const workflowGitRemoteService = {
    verifyBranchTip: vi.fn().mockResolvedValue(true),
  } as unknown as WorkflowGitRemoteService;

  const workflowArtifactService = {
    readManifest: vi.fn().mockResolvedValue(null),
    getPlanArtifactPaths: vi.fn().mockReturnValue({ planMetaPath: null, planHtmlPath: null }),
    writeExecutionArtifact: vi.fn().mockResolvedValue({
      htmlPath: 'execution/v1/execution.html',
      metaPath: 'execution/v1/execution.meta.json',
      sha256: 'sha',
    }),
  } as unknown as WorkflowArtifactService;

  const service = new WorkflowService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {
      normalizeAiProvider: () => 'codex',
      getConfiguredDefaultProvider: () => 'codex' as const,
      resolveInvocationContext: async () => ({}),
    } as never,
    { get: () => ({}) } as never,
    workflowArtifactService,
    workflowGitRemoteService,
  );

  return { service, workflowGitRemoteService, workflowArtifactService };
}

const baseWorkflow = {
  id: 'workflow-run-local-001',
  status: 'EXECUTION_PENDING',
  requirement: {
    id: 'req-1',
    title: 'Local handoff feature',
    description: 'desc',
    acceptanceCriteria: 'criteria',
  },
  tasks: [],
  plan: { ...confirmedPlan, status: 'CONFIRMED' },
  workflowRepositories: [
    {
      id: 'wr-1',
      repositoryId: 'repo-1',
      name: 'flowx',
      url: 'https://github.com/acme/flowx.git',
      baseBranch: 'main',
      workingBranch: 'flowx/work/local-handoff/workflow-run-local-001',
    },
  ],
  stageExecutions: [],
} as const;

describe('WorkflowService local execution', () => {
  it('claimLocalExecution returns handoff with working branch', async () => {
    const updatedWorkflow = {
      ...baseWorkflow,
      status: 'EXECUTION_RUNNING',
      stageExecutions: [
        {
          stage: 'EXECUTION',
          attempt: 1,
          status: 'RUNNING',
          input: { executor: 'LOCAL' },
        },
      ],
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          workflowRun: {
            findUniqueOrThrow: vi.fn().mockResolvedValue(updatedWorkflow),
          },
        }),
      ),
    };
    const { service } = createLocalExecutionService(prisma);

    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(baseWorkflow);
    vi.spyOn(service as never, 'resolveConfirmedPlan' as never).mockResolvedValue(confirmedPlan);
    vi.spyOn(service as never, 'assertStageNotRunning' as never).mockImplementation(() => undefined);
    vi.spyOn(service as never, 'transitionWorkflow' as never).mockResolvedValue(undefined);
    vi.spyOn(service as never, 'createStageExecution' as never).mockResolvedValue(undefined);

    const result = await service.claimLocalExecution('workflow-run-local-001');

    expect(result.handoff.repositories[0]?.workingBranch).toBe(
      'flowx/work/local-handoff/workflow-run-local-001',
    );
    expect(result.handoff.executor).toBe('LOCAL');
  });

  it('completeLocalExecution rejects when remote verify fails', async () => {
    const { service, workflowGitRemoteService } = createLocalExecutionService();
    const runningWorkflow = {
      ...baseWorkflow,
      status: 'EXECUTION_RUNNING',
      stageExecutions: [
        {
          stage: 'EXECUTION',
          attempt: 1,
          status: 'RUNNING',
          input: { executor: 'LOCAL' },
        },
      ],
    };

    vi.spyOn(workflowGitRemoteService, 'verifyBranchTip').mockResolvedValue(false);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(runningWorkflow);
    vi.spyOn(service as never, 'resolveConfirmedPlan' as never).mockResolvedValue(confirmedPlan);

    await expect(
      service.completeLocalExecution('workflow-run-local-001', {
        pushed: true,
        repositories: [
          {
            workflowRepositoryId: 'wr-1',
            headSha: 'deadbeef',
            changedFiles: ['src/App.tsx'],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('buildExecutionOutputFromLocalReport', () => {
  it('includes local chat implementation metadata in patch summary', () => {
    const output = buildExecutionOutputFromLocalReport(
      {
        workflowRunId: 'workflow-run-local-001',
        status: 'EXECUTION_RUNNING',
        executor: 'LOCAL',
        requirement: {
          id: 'req-1',
          title: 'Local handoff feature',
          description: 'desc',
          acceptanceCriteria: 'criteria',
        },
        plan: confirmedPlan,
        tasks: [],
        repositories: [
          {
            workflowRepositoryId: 'wr-1',
            repositoryId: 'repo-1',
            name: 'flowx',
            url: '',
            baseBranch: 'main',
            workingBranch: 'flowx/work/local-handoff/workflow-run-local-001',
            checkout: {
              fetch: 'git fetch origin',
              checkout: 'git checkout',
              push: 'git push',
            },
            suggestedCommitMessage: 'feat(flowx): local handoff',
          },
        ],
        artifacts: {
          planMetaPath: null,
          planHtmlPath: null,
        },
      },
      {
        pushed: false,
        implementationSummary: 'Added Cursor task handoff',
        testResult: 'pnpm --filter flowx-api test passed',
        diffSummary: '1 file changed',
        repositories: [
          {
            workflowRepositoryId: 'wr-1',
            headSha: 'deadbeef',
            changedFiles: ['src/App.tsx'],
            patchSummary: 'Updated app shell',
          },
        ],
      },
    );

    expect(output.patchSummary).toContain('[Local Chat]');
    expect(output.patchSummary).toContain('Summary: Added Cursor task handoff');
    expect(output.patchSummary).toContain('Tests: pnpm --filter flowx-api test passed');
    expect(output.patchSummary).toContain('Diff: 1 file changed');
  });
});
