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
  const prismaWithDefaults = {
    executionSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...((prisma.executionSession as Record<string, unknown> | undefined) ?? {}),
    },
    ...prisma,
  };
  if (prisma.executionSession) {
    prismaWithDefaults.executionSession = {
      findFirst: vi.fn().mockResolvedValue(null),
      ...(prisma.executionSession as Record<string, unknown>),
    };
  }
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
    prismaWithDefaults as never,
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

  return {
    service,
    prisma: prismaWithDefaults,
    workflowGitRemoteService,
    workflowArtifactService,
  };
}

const baseWorkflow = {
  id: 'workflow-run-local-001',
  status: 'EXECUTION_PENDING',
  requirement: {
    id: 'req-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    project: { workspaceId: 'workspace-1' },
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
  it('keeps the legacy path when the execution-session feature flag is disabled', () => {
    const original = process.env.FLOWX_EXECUTION_SESSION_WRITE_ENABLED;
    process.env.FLOWX_EXECUTION_SESSION_WRITE_ENABLED = 'false';
    try {
      const { service } = createLocalExecutionService();
      expect(
        (
          service as unknown as {
            isExecutionSessionProjectionEnabled: () => boolean;
          }
        ).isExecutionSessionProjectionEnabled(),
      ).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.FLOWX_EXECUTION_SESSION_WRITE_ENABLED;
      } else {
        process.env.FLOWX_EXECUTION_SESSION_WRITE_ENABLED = original;
      }
    }
  });

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
          executionSession: {
            create: vi.fn().mockImplementation(({ data }: { data: unknown }) => data),
          },
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
    vi.spyOn(service as never, 'createStageExecution' as never).mockResolvedValue({
      id: 'stage-1',
      attempt: 1,
    });

    const result = await service.claimLocalExecution('workflow-run-local-001');

    expect(result.handoff.repositories[0]?.workingBranch).toBe(
      'flowx/work/local-handoff/workflow-run-local-001',
    );
    expect(result.handoff.executor).toBe('LOCAL');
    expect(result.handoff.executionSessionId).toEqual(expect.any(String));
    expect(result.handoff.protocolVersion).toBe('1.0');
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

  it('returns the completed workflow for an idempotent completion retry', async () => {
    const { service, workflowArtifactService } = createLocalExecutionService({
      executionSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'session-1',
          status: 'COMPLETED',
          sourceTool: 'cursor',
          traceId: 'trace-1',
          protocolVersion: '1.0',
          metadata: { completionIdempotencyKey: 'complete-1' },
        }),
      },
    });
    const completedWorkflow = {
      ...baseWorkflow,
      status: 'REVIEW_PENDING',
      stageExecutions: [
        {
          stage: 'EXECUTION',
          attempt: 1,
          status: 'COMPLETED',
          input: { executor: 'LOCAL' },
        },
      ],
    };
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(completedWorkflow);
    vi.spyOn(service as never, 'resolveConfirmedPlan' as never).mockResolvedValue(confirmedPlan);

    const result = await service.completeLocalExecution('workflow-run-local-001', {
      idempotencyKey: 'complete-1',
      pushed: true,
      repositories: [
        {
          workflowRepositoryId: 'wr-1',
          headSha: 'deadbeef',
          changedFiles: ['src/App.tsx'],
        },
      ],
    });

    expect(result.workflow.status).toBe('REVIEW_PENDING');
    expect(workflowArtifactService.writeExecutionArtifact).not.toHaveBeenCalled();
  });

  it('completes the execution session and records Git, changed-file, test and summary evidence', async () => {
    const { service } = createLocalExecutionService();
    const tx = {
      executionSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      artifact: { findFirst: vi.fn().mockResolvedValue({ id: 'artifact-1' }) },
      evidence: { create: vi.fn().mockImplementation(({ data }: { data: unknown }) => data) },
    };

    await (
      service as unknown as {
        completeExecutionSessionProjection: (
          tx: unknown,
          workflowRunId: string,
          input: unknown,
        ) => Promise<void>;
      }
    ).completeExecutionSessionProjection(tx, 'workflow-run-local-001', {
      executionSession: {
        id: 'session-1',
        status: 'RUNNING',
        sourceTool: 'cursor',
        traceId: 'trace-1',
        protocolVersion: '1.0',
        metadata: null,
      },
      completionReport: {
        idempotencyKey: 'complete-1',
        pushed: true,
        implementationSummary: 'Implemented local workflow projection',
        testResult: 'pnpm test passed',
        repositories: [
          {
            workflowRepositoryId: 'wr-1',
            headSha: 'deadbeef1234',
            changedFiles: ['src/App.tsx'],
          },
        ],
      },
      verificationRows: [{ workflowRepositoryId: 'wr-1', verified: true }],
      repositories: [
        {
          workflowRepositoryId: 'wr-1',
          repositoryId: 'repo-1',
          name: 'flowx',
          url: 'https://github.com/acme/flowx.git',
          baseBranch: 'main',
          workingBranch: 'flowx/work/test',
          checkout: { fetch: '', checkout: '', push: '' },
          suggestedCommitMessage: 'feat: test',
        },
      ],
    });

    expect(tx.executionSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
    expect(tx.evidence.create.mock.calls.map(([call]) => call.data.evidenceType)).toEqual([
      'GIT_COMMIT',
      'CHANGED_FILES',
      'REMOTE_BRANCH_VERIFICATION',
      'TEST_RESULT',
      'AGENT_SUMMARY',
    ]);
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
