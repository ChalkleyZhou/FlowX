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
      executionSession: { findFirst: vi.fn().mockResolvedValue(null) },
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
      metadata: null,
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
});
