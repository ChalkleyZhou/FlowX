import { describe, expect, it, vi } from 'vitest';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowService } from './workflow.service';

const output = {
  spec: {
    goal: '支持本地 Spec & Plan',
    scope: ['本地领取', '资料上传'],
    nonGoals: [],
    acceptanceCriteria: ['回传后进入人工确认'],
    constraints: [],
  },
  plan: {
    approach: '复用 ExecutionSession 和 Artifact',
    touchpoints: ['workflow', 'artifacts'],
    sequence: ['领取', '上传', '回传'],
    risks: [],
    verification: ['API tests'],
  },
};

const workflow = {
  id: 'workflow-spec-1',
  status: 'SPEC_PLAN_PENDING',
  runType: 'FULL',
  aiProvider: 'codex',
  requirementId: 'req-1',
  requirement: {
    id: 'req-1',
    title: '本地 Spec & Plan',
    description: '允许本地 Agent 生成方案',
    acceptanceCriteria: '资料可追溯',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    project: { workspaceId: 'workspace-1' },
    workspace: null,
  },
  stageExecutions: [
    { id: 'stage-spec-1', stage: 'SPEC_PLAN', status: 'PENDING', attempt: 1, input: null },
  ],
  tasks: [],
  plan: null,
  codeExecution: null,
  reviewReport: null,
  reviewFindings: [],
  workflowRepositories: [
    {
      id: 'wr-1',
      repositoryId: 'repo-1',
      name: 'flowx',
      url: 'https://example.com/flowx.git',
      baseBranch: 'main',
      workingBranch: 'flowx/work/spec',
    },
  ],
  fixForBug: null,
};

function createService(prisma: Record<string, unknown>) {
  return new WorkflowService(
    prisma as never,
    new WorkflowStateMachine(),
    {} as never,
    {} as never,
    {
      normalizeAiProvider: () => 'codex',
      getConfiguredDefaultProvider: () => 'codex',
    } as never,
    { get: () => ({}) } as never,
    {} as never,
    {} as never,
  );
}

describe('WorkflowService local Spec & Plan', () => {
  it('claims the pending stage and returns a versioned handoff', async () => {
    const createSession = vi.fn().mockImplementation(({ data }) => data);
    const tx = {
      executionSession: { create: createSession },
      workflowRun: { findUniqueOrThrow: vi.fn().mockResolvedValue(workflow) },
    };
    const prisma = {
      executionSession: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
    vi.spyOn(
      service as never,
      'getOrCreateRunnableSkippableStageExecution' as never,
    ).mockResolvedValue({ id: 'stage-spec-1', attempt: 1 });
    vi.spyOn(service as never, 'updateStageExecution' as never).mockResolvedValue(undefined);

    const result = await service.claimLocalSpecPlan('workflow-spec-1', {
      user: { id: 'user-1', displayName: 'Developer' },
      organization: { id: 'org-1' },
    });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceTool: 'flowx-local',
          executorType: 'LOCAL',
          stageExecutionId: 'stage-spec-1',
          metadata: expect.objectContaining({ stage: 'SPEC_PLAN' }),
        }),
      }),
    );
    expect(result.handoff.contextPackage.outputContract).toEqual({
      resultFileName: 'spec-plan.json',
      specFileName: 'spec.md',
      planFileName: 'plan.md',
      format: 'flowx-spec-plan-v1',
    });
    expect(result.handoff.contextPackage.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects completion when required Markdown artifacts are missing', async () => {
    const activeSession = {
      id: 'session-spec-1',
      workflowRunId: 'workflow-spec-1',
      stageExecutionId: 'stage-spec-1',
      organizationId: 'org-1',
      status: 'RUNNING',
      sourceTool: 'flowx-local',
      protocolVersion: '1.1',
      traceId: 'trace-spec-1',
      metadata: { stage: 'SPEC_PLAN', sourceFingerprint: 'fingerprint-1' },
    };
    const prisma = {
      executionSession: { findUnique: vi.fn().mockResolvedValue(activeSession) },
      artifact: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'artifact-spec', artifactType: 'SPEC_MARKDOWN', status: 'AVAILABLE' },
        ]),
      },
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);

    await expect(
      service.completeLocalSpecPlanSession(
        'session-spec-1',
        {
          idempotencyKey: 'spec-plan:1',
          sourceFingerprint: 'fingerprint-1',
          output,
          artifactIds: ['artifact-spec'],
        },
        { organizationId: 'org-1' },
      ),
    ).rejects.toThrow(/SPEC_MARKDOWN.*PLAN_MARKDOWN/i);
  });

  it('persists output, completes the session and advances to confirmation', async () => {
    const activeSession = {
      id: 'session-spec-1',
      workflowRunId: 'workflow-spec-1',
      stageExecutionId: 'stage-spec-1',
      organizationId: 'org-1',
      status: 'RUNNING',
      sourceTool: 'flowx-local',
      protocolVersion: '1.1',
      traceId: 'trace-spec-1',
      metadata: { stage: 'SPEC_PLAN', sourceFingerprint: 'fingerprint-1' },
    };
    const completedWorkflow = { ...workflow, status: 'SPEC_PLAN_WAITING_CONFIRMATION' };
    const tx = {
      executionSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      evidence: { create: vi.fn() },
      workflowRun: { findUniqueOrThrow: vi.fn().mockResolvedValue(completedWorkflow) },
    };
    const prisma = {
      executionSession: { findUnique: vi.fn().mockResolvedValue(activeSession) },
      artifact: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'artifact-spec', artifactType: 'SPEC_MARKDOWN', status: 'AVAILABLE' },
          { id: 'artifact-plan', artifactType: 'PLAN_MARKDOWN', status: 'AVAILABLE' },
        ]),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
    const updateStage = vi
      .spyOn(service as never, 'updateStageExecution' as never)
      .mockResolvedValue(undefined);
    const transition = vi
      .spyOn(service as never, 'transitionWorkflow' as never)
      .mockResolvedValue(undefined);

    const result = await service.completeLocalSpecPlanSession(
      'session-spec-1',
      {
        idempotencyKey: 'spec-plan:1',
        sourceFingerprint: 'fingerprint-1',
        output,
        artifactIds: ['artifact-spec', 'artifact-plan'],
      },
      { organizationId: 'org-1' },
    );

    expect(updateStage).toHaveBeenCalledWith(
      tx,
      'stage-spec-1',
      expect.anything(),
      expect.objectContaining({ output }),
    );
    expect(transition).toHaveBeenCalled();
    expect(tx.executionSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(result.workflowStatus).toBe('SPEC_PLAN_WAITING_CONFIRMATION');
  });
});
