import { describe, expect, it, vi } from 'vitest';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowService } from './workflow.service';

const workflow = {
  id: 'workflow-design-1',
  status: 'DESIGN_PENDING',
  runType: 'LOCAL_DESIGN',
  aiProvider: 'codex',
  requirementId: 'req-1',
  requirement: {
    id: 'req-1',
    title: 'Export page',
    description: 'Design an export experience',
    acceptanceCriteria: 'Covers loading, empty and error states',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    project: { workspaceId: 'workspace-1' },
    workspace: null,
  },
  stageExecutions: [
    { id: 'stage-design-1', stage: 'DESIGN', status: 'PENDING', attempt: 1, input: null },
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
      name: 'flowx-web',
      url: 'https://example.com/flowx-web.git',
      baseBranch: 'main',
      workingBranch: 'flowx/work/design',
    },
  ],
  fixForBug: null,
};

function createService(prisma: Record<string, unknown>, artifactsService?: unknown) {
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
    artifactsService as never,
  );
}

describe('WorkflowService local OpenDesign', () => {
  it('claims the DESIGN stage and creates an OpenDesign execution session', async () => {
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
    ).mockResolvedValue({ id: 'stage-design-1', attempt: 1 });
    vi.spyOn(service as never, 'updateStageExecution' as never).mockResolvedValue(undefined);

    const result = await service.claimLocalDesign('workflow-design-1', {
      user: { id: 'user-1', displayName: 'Designer' },
      organization: { id: 'org-1' },
    });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceTool: 'opendesign',
          executorType: 'LOCAL',
          stageExecutionId: 'stage-design-1',
        }),
      }),
    );
    expect(result.handoff.contextPackage.requirement.id).toBe('req-1');
    expect(result.handoff.contextPackage.outputContract.resultFileName).toBe('result.json');
  });

  it('claims the BRAINSTORM stage for markdown OpenDesign handoff', async () => {
    const brainstormWorkflow = {
      ...workflow,
      status: 'BRAINSTORM_PENDING',
      stageExecutions: [
        { id: 'stage-brainstorm-1', stage: 'BRAINSTORM', status: 'PENDING', attempt: 1, input: null },
      ],
    };
    const createSession = vi.fn().mockImplementation(({ data }) => data);
    const tx = {
      executionSession: { create: createSession },
      workflowRun: { findUniqueOrThrow: vi.fn().mockResolvedValue(brainstormWorkflow) },
    };
    const prisma = {
      executionSession: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(brainstormWorkflow);
    vi.spyOn(
      service as never,
      'getOrCreateRunnableSkippableStageExecution' as never,
    ).mockResolvedValue({ id: 'stage-brainstorm-1', attempt: 1 });
    vi.spyOn(service as never, 'updateStageExecution' as never).mockResolvedValue(undefined);

    const result = await service.claimLocalBrainstorm('workflow-design-1', {
      user: { id: 'user-1', displayName: 'Designer' },
      organization: { id: 'org-1' },
    });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ stage: 'BRAINSTORM' }),
        }),
      }),
    );
    expect(result.handoff.contextPackage.outputContract.resultFileName).toBe('spec.md');
  });

  it('completes the design session and moves the workflow to confirmation', async () => {
    const activeSession = {
      id: 'session-1',
      workflowRunId: 'workflow-design-1',
      stageExecutionId: 'stage-design-1',
      organizationId: 'org-1',
      status: 'RUNNING',
      sourceTool: 'opendesign',
      protocolVersion: '1.0',
      traceId: 'trace-1',
      metadata: { stage: 'DESIGN' },
    };
    const completedWorkflow = { ...workflow, status: 'DESIGN_WAITING_CONFIRMATION' };
    const tx = {
      executionSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      artifact: { findFirst: vi.fn().mockResolvedValue({ id: 'artifact-1' }) },
      evidence: { create: vi.fn().mockResolvedValue({ id: 'evidence-1' }) },
      workflowRun: { findUniqueOrThrow: vi.fn().mockResolvedValue(completedWorkflow) },
    };
    const prisma = {
      executionSession: { findUnique: vi.fn().mockResolvedValue(activeSession) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const artifacts = {
      registerWorkflowArtifact: vi.fn().mockResolvedValue({ id: 'artifact-1' }),
    };
    const service = createService(prisma, artifacts);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
    vi.spyOn(service as never, 'persistWorkflowDesignArtifact' as never).mockResolvedValue({
      relPath: 'workflow-design-1/design.html',
      bytes: 100,
      generatedAt: '2026-07-22T00:00:00.000Z',
    });
    vi.spyOn(service as never, 'updateStageExecution' as never).mockResolvedValue(undefined);
    vi.spyOn(service as never, 'transitionWorkflow' as never).mockResolvedValue(undefined);

    const result = await service.completeLocalDesignSession(
      'session-1',
      {
        idempotencyKey: 'design:session-1:v1',
        summary: 'Completed locally',
        output: {
          design: {
            overview: 'High fidelity design',
            pages: [{ name: 'P', route: '/p', layout: 'L', keyComponents: [], interactions: [] }],
            demoScenario: 'Primary flow',
            designRationale: 'Clear hierarchy',
          },
          demo: {
            summary: 'Flow',
            flows: [{ name: 'main', goal: 'export', entry: '/p', states: [] }],
            scope: { included: [], excluded: [] },
            knownGaps: [],
          },
          designArtifact: { html: '<!doctype html><html><body>Design</body></html>' },
        },
      },
      { organizationId: 'org-1' },
    );

    expect(result.workflow.status).toBe('DESIGN_WAITING_CONFIRMATION');
    expect(tx.executionSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
    expect(tx.evidence.create).toHaveBeenCalled();
  });

  it('creates a new OpenDesign session after the previous design was rejected', async () => {
    const rejectedWorkflow = {
      ...workflow,
      status: 'DESIGN_PENDING',
      stageExecutions: [
        {
          id: 'stage-design-1',
          stage: 'DESIGN',
          status: 'REJECTED',
          attempt: 1,
          input: null,
        },
      ],
    };
    const createSession = vi.fn().mockImplementation(({ data }) => data);
    const tx = {
      executionSession: {
        create: createSession,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      workflowRun: { findUniqueOrThrow: vi.fn().mockResolvedValue(rejectedWorkflow) },
    };
    const prisma = {
      // Previous OpenDesign session is COMPLETED after submit, so it must not block reclaim.
      executionSession: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(rejectedWorkflow);
    vi.spyOn(
      service as never,
      'getOrCreateRunnableSkippableStageExecution' as never,
    ).mockResolvedValue({ id: 'stage-design-2', attempt: 2 });
    vi.spyOn(service as never, 'updateStageExecution' as never).mockResolvedValue(undefined);

    const result = await service.claimLocalDesign('workflow-design-1', {
      user: { id: 'user-1', displayName: 'Designer' },
      organization: { id: 'org-1' },
    });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stageExecutionId: 'stage-design-2',
          idempotencyKey: 'local-design:workflow-design-1:stage-design-2',
          sourceTool: 'opendesign',
        }),
      }),
    );
    expect(result.handoff.executionSessionId).toBeTruthy();
  });

  it('getLocalDesignHandoff claims a design session when none is active', async () => {
    const prisma = {
      executionSession: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
    const claimedHandoff = {
      protocolVersion: '1.0',
      workflowRunId: 'workflow-design-1',
      executionSessionId: 'session-lazy-design',
      traceId: 'trace-lazy',
      contextPackage: {
        protocolVersion: '1.0',
        generatedAt: '2026-07-24T00:00:00.000Z',
        sourceTool: 'opendesign' as const,
        workflowRunId: 'workflow-design-1',
        executionSessionId: 'session-lazy-design',
        traceId: 'trace-lazy',
        requirement: {
          id: 'req-1',
          title: 'Export page',
          description: 'Design an export experience',
          acceptanceCriteria: 'Covers loading, empty and error states',
        },
        repositories: [],
        outputContract: {
          resultFileName: 'result.json' as const,
          format: 'flowx-design-result-v1' as const,
          requiredFields: ['design', 'demo', 'designArtifact'] as const,
        },
      },
      completionEndpoint: '/execution-sessions/session-lazy-design/design/complete',
    };
    const claimSpy = vi.spyOn(service, 'claimLocalDesign').mockResolvedValue({
      workflow: workflow as never,
      handoff: claimedHandoff,
    });
    const notifyRecipient = {
      user: { id: 'user-1', displayName: 'Designer' },
      organization: { id: 'org-1' },
    };

    const result = await service.getLocalDesignHandoff('workflow-design-1', notifyRecipient);

    expect(claimSpy).toHaveBeenCalledWith('workflow-design-1', notifyRecipient);
    expect(result.executionSessionId).toBe('session-lazy-design');
  });

  it('getLocalDesignHandoff reuses an active design session without claiming again', async () => {
    const activeSession = {
      id: 'session-active',
      workflowRunId: 'workflow-design-1',
      stageExecutionId: 'stage-design-1',
      status: 'RUNNING',
      sourceTool: 'opendesign',
      protocolVersion: '1.0',
      traceId: 'trace-active',
      metadata: { stage: 'DESIGN' },
    };
    const prisma = {
      executionSession: { findMany: vi.fn().mockResolvedValue([activeSession]) },
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
    const claimSpy = vi.spyOn(service, 'claimLocalDesign');

    const result = await service.getLocalDesignHandoff('workflow-design-1');

    expect(claimSpy).not.toHaveBeenCalled();
    expect(result.executionSessionId).toBe('session-active');
  });

  it('getLocalDesignHandoff rejects when workflow cannot accept design handoff', async () => {
    const prisma = {
      executionSession: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue({
      ...workflow,
      status: 'DESIGN_WAITING_CONFIRMATION',
    });

    await expect(service.getLocalDesignHandoff('workflow-design-1')).rejects.toThrow(
      /does not allow design handoff/i,
    );
  });

  it('getLocalBrainstormHandoff claims a brainstorm session when none is active', async () => {
    const brainstormWorkflow = {
      ...workflow,
      status: 'BRAINSTORM_PENDING',
      stageExecutions: [
        { id: 'stage-brainstorm-1', stage: 'BRAINSTORM', status: 'PENDING', attempt: 1, input: null },
      ],
    };
    const prisma = {
      executionSession: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(brainstormWorkflow);
    const claimedHandoff = {
      protocolVersion: '1.0',
      workflowRunId: 'workflow-design-1',
      executionSessionId: 'session-lazy-brainstorm',
      traceId: 'trace-brainstorm',
      contextPackage: {
        protocolVersion: '1.0',
        generatedAt: '2026-07-24T00:00:00.000Z',
        sourceTool: 'opendesign' as const,
        stage: 'BRAINSTORM' as const,
        workflowRunId: 'workflow-design-1',
        executionSessionId: 'session-lazy-brainstorm',
        traceId: 'trace-brainstorm',
        requirement: {
          id: 'req-1',
          title: 'Export page',
          description: 'Design an export experience',
          acceptanceCriteria: 'Covers loading, empty and error states',
        },
        repositories: [],
        outputContract: {
          resultFileName: 'spec.md' as const,
          format: 'flowx-brainstorm-markdown-v1' as const,
        },
      },
      completionEndpoint: '/execution-sessions/session-lazy-brainstorm/brainstorm/complete',
    };
    const claimSpy = vi.spyOn(service, 'claimLocalBrainstorm').mockResolvedValue({
      workflow: brainstormWorkflow as never,
      handoff: claimedHandoff,
    });
    const notifyRecipient = {
      user: { id: 'user-1', displayName: 'Designer' },
      organization: { id: 'org-1' },
    };

    const result = await service.getLocalBrainstormHandoff('workflow-design-1', notifyRecipient);

    expect(claimSpy).toHaveBeenCalledWith('workflow-design-1', notifyRecipient);
    expect(result.executionSessionId).toBe('session-lazy-brainstorm');
  });

  it('completeLocalBrainstormSession includes next design pointer', async () => {
    const brainstormWorkflow = {
      ...workflow,
      status: 'BRAINSTORM_PENDING',
      stageExecutions: [
        { id: 'stage-brainstorm-1', stage: 'BRAINSTORM', status: 'RUNNING', attempt: 1, input: null },
      ],
    };
    const activeSession = {
      id: 'session-b',
      workflowRunId: 'workflow-design-1',
      stageExecutionId: 'stage-brainstorm-1',
      organizationId: 'org-1',
      status: 'RUNNING',
      sourceTool: 'opendesign',
      protocolVersion: '1.0',
      traceId: 'trace-b',
      metadata: { stage: 'BRAINSTORM' },
    };
    const designPendingWorkflow = { ...brainstormWorkflow, status: 'DESIGN_PENDING' };
    const tx = {
      executionSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      evidence: { create: vi.fn().mockResolvedValue({ id: 'evidence-1' }) },
      workflowRun: { findUniqueOrThrow: vi.fn().mockResolvedValue(designPendingWorkflow) },
    };
    const prisma = {
      executionSession: { findUnique: vi.fn().mockResolvedValue(activeSession) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(brainstormWorkflow);
    vi.spyOn(service as never, 'updateStageExecution' as never).mockResolvedValue(undefined);
    vi.spyOn(service as never, 'transitionWorkflow' as never).mockResolvedValue(undefined);
    vi.spyOn(service as never, 'createStageExecution' as never).mockResolvedValue(undefined);

    const result = await service.completeLocalBrainstormSession(
      'session-b',
      {
        idempotencyKey: 'brainstorm:session-b:v1',
        summary: 'Spec ready',
        markdown: '# Spec\n\nDone.',
      },
      { organizationId: 'org-1' },
    );

    expect(result.workflow.status).toBe('DESIGN_PENDING');
    expect(result.workflowRunId).toBe('workflow-design-1');
    expect(result.workflowStatus).toBe('DESIGN_PENDING');
    expect(result.next).toEqual({
      stage: 'design',
      hint: 'call flowx_get_design_handoff',
    });
  });

  it('completeLocalBrainstormSession idempotent replay includes next when DESIGN_PENDING', async () => {
    const designPendingWorkflow = {
      ...workflow,
      status: 'DESIGN_PENDING',
    };
    const completedSession = {
      id: 'session-b',
      workflowRunId: 'workflow-design-1',
      stageExecutionId: 'stage-brainstorm-1',
      organizationId: 'org-1',
      status: 'COMPLETED',
      sourceTool: 'opendesign',
      protocolVersion: '1.0',
      traceId: 'trace-b',
      metadata: {
        stage: 'BRAINSTORM',
        completionIdempotencyKey: 'brainstorm:session-b:v1',
      },
    };
    const prisma = {
      executionSession: { findUnique: vi.fn().mockResolvedValue(completedSession) },
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(
      designPendingWorkflow,
    );

    const result = await service.completeLocalBrainstormSession(
      'session-b',
      {
        idempotencyKey: 'brainstorm:session-b:v1',
        summary: 'Spec ready',
        markdown: '# Spec\n\nDone.',
      },
      { organizationId: 'org-1' },
    );

    expect(result.workflowStatus).toBe('DESIGN_PENDING');
    expect(result.workflowRunId).toBe('workflow-design-1');
    expect(result.next).toEqual({
      stage: 'design',
      hint: 'call flowx_get_design_handoff',
    });
  });
});
