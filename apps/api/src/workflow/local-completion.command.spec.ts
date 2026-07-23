import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { GeneratePlanOutput } from '../common/types';
import { StageType } from '../common/enums';
import { LocalCompletionCommand, type LocalCompletionWorkflowGateway } from './local-completion.command';
import { WorkflowArtifactService } from './workflow-artifact.service';
import { WorkflowGitRemoteService } from './workflow-git-remote.service';
import type { LocalHandoffPayload } from './workflow-local-handoff';
import type { LocalExecutionSessionProjection, WorkflowPayload } from './workflow.service';

const confirmedPlan: GeneratePlanOutput = {
  summary: 'Plan summary',
  implementationPlan: ['step'],
  filesToModify: ['src/App.tsx'],
  newFiles: [],
  riskPoints: [],
};

const baseHandoff: LocalHandoffPayload = {
  workflowRunId: 'workflow-run-1',
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
      url: 'https://github.com/acme/flowx.git',
      baseBranch: 'main',
      workingBranch: 'flowx/work/local-handoff/workflow-run-1',
      checkout: { fetch: 'git fetch origin', checkout: 'git checkout', push: 'git push' },
      suggestedCommitMessage: 'feat: local handoff',
    },
  ],
  artifacts: { planMetaPath: null, planHtmlPath: null },
};

const baseWorkflow = {
  id: 'workflow-run-1',
  status: 'EXECUTION_RUNNING',
  requirement: { id: 'req-1', title: 'Local handoff feature' },
  workflowRepositories: [
    {
      id: 'wr-1',
      repositoryId: 'repo-1',
      name: 'flowx',
      url: 'https://github.com/acme/flowx.git',
      baseBranch: 'main',
      workingBranch: 'flowx/work/local-handoff/workflow-run-1',
    },
  ],
} as unknown as WorkflowPayload;

function createCommand() {
  const workflowArtifactService = {
    writeExecutionArtifact: vi.fn().mockResolvedValue({
      htmlPath: 'execution/v1/execution.html',
      metaPath: 'execution/v1/execution.meta.json',
      sha256: 'sha',
    }),
  } as unknown as WorkflowArtifactService;

  const workflowGitRemoteService = {
    verifyBranchTip: vi.fn().mockResolvedValue(true),
  } as unknown as WorkflowGitRemoteService;

  const command = new LocalCompletionCommand(workflowArtifactService, workflowGitRemoteService);

  return { command, workflowArtifactService, workflowGitRemoteService };
}

function createGateway(overrides: Partial<LocalCompletionWorkflowGateway> = {}): LocalCompletionWorkflowGateway {
  return {
    getWorkflowOrThrow: vi.fn().mockResolvedValue(baseWorkflow),
    buildCompletionReport: vi.fn().mockImplementation((executionSessionId, _handoff, dto) => ({
      idempotencyKey: dto.idempotencyKey ?? `completion:${executionSessionId}:generated`,
      pushed: dto.pushed,
      implementationSummary: dto.implementationSummary,
      testResult: dto.testResult,
      diffSummary: dto.diffSummary,
      untrackedFiles: dto.untrackedFiles,
      repositories: dto.repositories,
    })),
    readCompletionIdempotencyKey: vi.fn().mockReturnValue(null),
    assertLocalExecutionActive: vi.fn(),
    sanitizeExecutionOutputPaths: vi.fn().mockImplementation((output) => output),
    getLatestStageOrThrow: vi.fn().mockReturnValue({ attempt: 1, input: { executor: 'LOCAL' } }),
    finalizeExecutionSuccess: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const validDto = {
  pushed: true,
  repositories: [
    {
      workflowRepositoryId: 'wr-1',
      headSha: 'deadbeef',
      changedFiles: ['src/App.tsx'],
    },
  ],
};

describe('LocalCompletionCommand', () => {
  it('verifies remotes, attaches the artifact and finalizes the workflow', async () => {
    const { command, workflowArtifactService, workflowGitRemoteService } = createCommand();
    const gateway = createGateway();

    const result = await command.run({
      workflow: baseWorkflow,
      executionSession: {
        id: 'session-1',
        status: 'RUNNING',
        sourceTool: 'cursor',
        traceId: 'trace-1',
        protocolVersion: '1.0',
        metadata: null,
      } as LocalExecutionSessionProjection,
      handoff: baseHandoff,
      dto: validDto,
      notifyRecipient: null,
      gateway,
    });

    expect(workflowGitRemoteService.verifyBranchTip).toHaveBeenCalledWith(
      'https://github.com/acme/flowx.git',
      'flowx/work/local-handoff/workflow-run-1',
      'deadbeef',
    );
    expect(workflowArtifactService.writeExecutionArtifact).toHaveBeenCalled();
    expect(gateway.getLatestStageOrThrow).toHaveBeenCalledWith(baseWorkflow, StageType.EXECUTION);
    expect(gateway.finalizeExecutionSuccess).toHaveBeenCalledWith(
      'workflow-run-1',
      expect.objectContaining({ _artifact: expect.objectContaining({ kind: 'execution' }) }),
      expect.objectContaining({
        executor: 'LOCAL',
        localCompletion: expect.objectContaining({
          verificationRows: [{ workflowRepositoryId: 'wr-1', verified: true }],
        }),
      }),
    );
    expect(result.workflow).toBe(baseWorkflow);
  });

  it('returns the prior result without re-running side effects on a matching idempotent retry', async () => {
    const { command } = createCommand();
    const gateway = createGateway({
      readCompletionIdempotencyKey: vi.fn().mockReturnValue('completion:session-1:generated'),
    });
    const completedWorkflow = { ...baseWorkflow, status: 'REVIEW_PENDING' } as WorkflowPayload;

    const result = await command.run({
      workflow: completedWorkflow,
      executionSession: {
        id: 'session-1',
        status: 'COMPLETED',
        sourceTool: 'cursor',
        traceId: 'trace-1',
        protocolVersion: '1.0',
        metadata: { completionIdempotencyKey: 'completion:session-1:generated' },
      } as LocalExecutionSessionProjection,
      handoff: baseHandoff,
      dto: { ...validDto, idempotencyKey: 'completion:session-1:generated' },
      notifyRecipient: null,
      gateway,
    });

    expect(result.workflow).toBe(completedWorkflow);
    expect(gateway.finalizeExecutionSuccess).not.toHaveBeenCalled();
  });

  it('rejects an unknown workflow repository', async () => {
    const { command } = createCommand();
    const gateway = createGateway();

    await expect(
      command.run({
        workflow: baseWorkflow,
        executionSession: null,
        handoff: baseHandoff,
        dto: {
          pushed: true,
          repositories: [{ workflowRepositoryId: 'unknown-wr', headSha: 'deadbeef', changedFiles: ['a.ts'] }],
        },
        notifyRecipient: null,
        gateway,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires push when the workflow repository has a remote', async () => {
    const { command } = createCommand();
    const gateway = createGateway();

    await expect(
      command.run({
        workflow: baseWorkflow,
        executionSession: null,
        handoff: baseHandoff,
        dto: { ...validDto, pushed: false },
        notifyRecipient: null,
        gateway,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('raises a structured REMOTE_BRANCH_NOT_VERIFIED error when the remote tip is missing', async () => {
    const { command, workflowGitRemoteService } = createCommand();
    vi.spyOn(workflowGitRemoteService, 'verifyBranchTip').mockResolvedValue(false);
    const gateway = createGateway();

    await expect(
      command.run({
        workflow: baseWorkflow,
        executionSession: null,
        handoff: baseHandoff,
        dto: validDto,
        notifyRecipient: null,
        gateway,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REMOTE_BRANCH_NOT_VERIFIED' }),
    });
  });
});
