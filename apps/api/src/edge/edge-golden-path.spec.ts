import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { GeneratePlanOutput } from '../common/types';
import { WorkflowArtifactService } from '../workflow/workflow-artifact.service';
import { WorkflowGitRemoteService } from '../workflow/workflow-git-remote.service';
import { WorkflowService } from '../workflow/workflow.service';

const confirmedPlan: GeneratePlanOutput = {
  summary: 'Golden path plan',
  implementationPlan: ['implement'],
  filesToModify: ['src/App.tsx'],
  newFiles: [],
  riskPoints: [],
};

const baseWorkflow = {
  id: 'workflow-golden-001',
  status: 'EXECUTION_RUNNING',
  requirement: {
    id: 'requirement-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    project: { workspaceId: 'workspace-1' },
    title: 'Golden-path requirement',
    description: 'description',
    acceptanceCriteria: 'criteria',
  },
  tasks: [],
  plan: { ...confirmedPlan, status: 'CONFIRMED' },
  workflowRepositories: [
    {
      id: 'wr-1',
      repositoryId: 'repository-1',
      name: 'flowx',
      url: 'https://github.com/acme/flowx.git',
      baseBranch: 'main',
      workingBranch: 'flowx/work/golden-path/golden-001',
    },
  ],
  stageExecutions: [
    {
      id: 'stage-1',
      stage: 'EXECUTION',
      attempt: 1,
      status: 'RUNNING',
      input: { executor: 'LOCAL' },
    },
  ],
} as const;

function createService(session: Record<string, unknown> | null) {
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
  const prisma = {
    executionSession: {
      findFirst: vi.fn().mockResolvedValue(session),
      findUnique: vi.fn().mockResolvedValue(session),
      findUniqueOrThrow: vi.fn().mockResolvedValue(session),
    },
  };
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

  return { service, prisma, workflowArtifactService, workflowGitRemoteService };
}

function runningSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-golden-001',
    workflowRunId: baseWorkflow.id,
    status: 'RUNNING',
    executorType: 'LOCAL',
    organizationId: null,
    sourceTool: 'cursor',
    traceId: 'trace-golden-001',
    protocolVersion: '1.0',
    metadata: null,
    ...overrides,
  };
}

const completionDto = {
  idempotencyKey: 'complete-golden-001',
  pushed: true,
  repositories: [
    {
      workflowRepositoryId: 'wr-1',
      headSha: 'deadbeef',
      changedFiles: ['src/App.tsx'],
    },
  ],
};

function stubRunningWorkflow(service: WorkflowService, workflow = baseWorkflow) {
  vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
  vi.spyOn(service as never, 'resolveConfirmedPlan' as never).mockResolvedValue(confirmedPlan);
}

describe('Edge development golden path', () => {
  it('claims a local session, completes it, and advances the workflow toward review', async () => {
    const session = runningSession();
    const { service, prisma } = createService(session);
    let workflow = baseWorkflow;
    const claimableWorkflow = { ...baseWorkflow, status: 'EXECUTION_PENDING', stageExecutions: [] };
    const getWorkflowOrThrow = vi
      .spyOn(service as never, 'getWorkflowOrThrow' as never)
      .mockResolvedValue(claimableWorkflow);
    vi.spyOn(service as never, 'resolveConfirmedPlan' as never).mockResolvedValue(confirmedPlan);
    vi.spyOn(service as never, 'assertStageNotRunning' as never).mockImplementation(() => undefined);
    vi.spyOn(service as never, 'transitionWorkflow' as never).mockResolvedValue(undefined);
    vi.spyOn(service as never, 'createStageExecution' as never).mockResolvedValue({
      id: 'stage-1',
      attempt: 1,
    });
    (prisma as Record<string, unknown>).$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        executionSession: {
          create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            Object.assign(session, data);
            return data;
          }),
        },
        workflowRun: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(baseWorkflow),
        },
      }),
    );
    vi.spyOn(service as never, 'buildLocalHandoffForWorkflow' as never).mockResolvedValue({
      workflowRunId: workflow.id,
      status: workflow.status,
      executor: 'LOCAL',
      executionSessionId: session.id,
      traceId: session.traceId,
      protocolVersion: '1.0',
      requirement: workflow.requirement,
      plan: confirmedPlan,
      tasks: [],
      repositories: workflow.workflowRepositories.map((repository) => ({
        ...repository,
        workflowRepositoryId: repository.id,
        checkout: { fetch: '', checkout: '', push: '' },
        suggestedCommitMessage: 'feat: golden path',
      })),
      artifacts: { planMetaPath: null, planHtmlPath: null },
    });
    vi.spyOn(service as never, 'sanitizeExecutionOutputPaths' as never).mockImplementation((output) => output);
    vi.spyOn(service as never, 'getLatestStageOrThrow' as never).mockReturnValue(baseWorkflow.stageExecutions[0]);
    vi.spyOn(service as never, 'finalizeExecutionSuccess' as never).mockImplementation(async () => {
      workflow = { ...baseWorkflow, status: 'REVIEW_PENDING' };
      Object.assign(session, {
        status: 'COMPLETED',
        metadata: { completionIdempotencyKey: completionDto.idempotencyKey },
      });
    });
    const claim = await service.claimLocalExecution(baseWorkflow.id);
    getWorkflowOrThrow.mockImplementation(async () => workflow);
    const result = await service.completeLocalExecutionBySession(session.id, completionDto);

    expect(claim.handoff.executionSessionId).toEqual(expect.any(String));
    expect(result.executionSession.status).toBe('COMPLETED');
    expect(result.workflow.status).toBe('REVIEW_PENDING');
    expect(prisma.executionSession.findUnique).toHaveBeenCalledWith({ where: { id: session.id } });
  });

  it('returns the original workflow when the same completion idempotency key is replayed', async () => {
    const session = runningSession({
      status: 'COMPLETED',
      metadata: { completionIdempotencyKey: completionDto.idempotencyKey },
    });
    const completedWorkflow = { ...baseWorkflow, status: 'REVIEW_PENDING' };
    const { service, workflowArtifactService } = createService(session);
    stubRunningWorkflow(service, completedWorkflow);
    vi.spyOn(service as never, 'buildLocalHandoffForWorkflow' as never).mockResolvedValue({
      workflowRunId: completedWorkflow.id,
      status: completedWorkflow.status,
      executor: 'LOCAL',
      executionSessionId: session.id,
      traceId: session.traceId,
      protocolVersion: '1.0',
      requirement: completedWorkflow.requirement,
      plan: confirmedPlan,
      tasks: [],
      repositories: [],
      artifacts: { planMetaPath: null, planHtmlPath: null },
    });

    const result = await service.completeLocalExecutionBySession(session.id, completionDto);

    expect(result.workflow.status).toBe('REVIEW_PENDING');
    expect(result.executionSession).toBe(session);
    expect(workflowArtifactService.writeExecutionArtifact).not.toHaveBeenCalled();
  });

  it('rejects an unpushed completion when a repository has a remote URL', async () => {
    const session = runningSession();
    const { service } = createService(session);
    stubRunningWorkflow(service);
    vi.spyOn(service as never, 'buildLocalHandoffForWorkflow' as never).mockResolvedValue({
      workflowRunId: baseWorkflow.id,
      status: baseWorkflow.status,
      executor: 'LOCAL',
      executionSessionId: session.id,
      traceId: session.traceId,
      protocolVersion: '1.0',
      requirement: baseWorkflow.requirement,
      plan: confirmedPlan,
      tasks: [],
      repositories: baseWorkflow.workflowRepositories.map((repository) => ({
        ...repository,
        workflowRepositoryId: repository.id,
        checkout: { fetch: '', checkout: '', push: '' },
        suggestedCommitMessage: 'feat: golden path',
      })),
      artifacts: { planMetaPath: null, planHtmlPath: null },
    });

    await expect(
      service.completeLocalExecutionBySession(session.id, { ...completionDto, pushed: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a stale completion after local execution has been cancelled', async () => {
    const session = runningSession({ status: 'CANCELLED' });
    const { service } = createService(session);
    stubRunningWorkflow(service, { ...baseWorkflow, status: 'EXECUTION_PENDING' });
    vi.spyOn(service as never, 'buildLocalHandoffForWorkflow' as never).mockResolvedValue({});

    await expect(service.completeLocalExecutionBySession(session.id, completionDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('keeps complete-local working as a compatibility wrapper without a session', async () => {
    const { service } = createService(null);
    const handoff = { workflowRunId: baseWorkflow.id, executor: 'LOCAL' };
    const completedWorkflow = { ...baseWorkflow, status: 'REVIEW_PENDING' };
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(baseWorkflow);
    vi.spyOn(service as never, 'buildLocalHandoffForWorkflow' as never).mockResolvedValue(handoff);
    vi.spyOn((service as never).localCompletionCommand, 'run').mockResolvedValue({
      workflow: completedWorkflow,
      handoff,
    });

    const result = await service.completeLocalExecution(baseWorkflow.id, completionDto);

    expect(result).toEqual({ workflow: completedWorkflow, handoff });
  });
});
