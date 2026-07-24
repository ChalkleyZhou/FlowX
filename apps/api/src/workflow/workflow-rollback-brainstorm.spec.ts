import { describe, expect, it, vi } from 'vitest';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowService } from './workflow.service';

const designWorkflow = {
  id: 'workflow-rb-1',
  status: 'DESIGN_PENDING',
  requirementId: 'req-1',
  stageExecutions: [
    {
      id: 'stage-brainstorm-1',
      stage: 'BRAINSTORM',
      status: 'COMPLETED',
      attempt: 1,
      output: { markdown: '# Spec\n\nold' },
    },
    {
      id: 'stage-design-1',
      stage: 'DESIGN',
      status: 'PENDING',
      attempt: 1,
      output: { html: '<div>design</div>' },
    },
  ],
  workflowRepositories: [],
  tasks: [],
  plan: null,
  codeExecution: null,
  reviewReport: null,
  reviewFindings: [],
};

const rolledBackWorkflow = {
  ...designWorkflow,
  status: 'BRAINSTORM_PENDING',
  stageExecutions: [
    ...designWorkflow.stageExecutions,
    {
      id: 'stage-brainstorm-2',
      stage: 'BRAINSTORM',
      status: 'PENDING',
      attempt: 2,
      statusMessage: '已回退到此阶段，请重新执行',
      input: {
        requirementId: 'req-1',
        workflowRunId: 'workflow-rb-1',
        source: 'rollback',
      },
    },
  ],
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
    {} as never,
  );
}

describe('WorkflowService rollback DESIGN to BRAINSTORM', () => {
  it('creates a new PENDING brainstorm stage and keeps design stage output', async () => {
    const stageExecutionCreate = vi.fn().mockResolvedValue({
      id: 'stage-brainstorm-2',
      stage: 'BRAINSTORM',
      status: 'PENDING',
      attempt: 2,
    });
    const stageExecutionDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = {
      reviewFinding: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      reviewReport: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      codeExecution: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      plan: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      task: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      stageExecution: {
        findFirst: vi.fn().mockResolvedValue({ attempt: 1 }),
        create: stageExecutionCreate,
        deleteMany: stageExecutionDeleteMany,
      },
      workflowRun: {
        update: vi.fn().mockResolvedValue(undefined),
        findUniqueOrThrow: vi.fn().mockResolvedValue(rolledBackWorkflow),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(designWorkflow);

    const result = await service.rollbackToPreviousStage('workflow-rb-1');

    expect(result.status).toBe('BRAINSTORM_PENDING');
    expect(tx.workflowRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'workflow-rb-1' },
        data: expect.objectContaining({
          status: 'BRAINSTORM_PENDING',
          currentStage: 'BRAINSTORM',
        }),
      }),
    );
    expect(stageExecutionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowRunId: 'workflow-rb-1',
        stage: 'BRAINSTORM',
        attempt: 2,
        status: 'PENDING',
        statusMessage: '已回退到此阶段，请重新执行',
        input: {
          requirementId: 'req-1',
          workflowRunId: 'workflow-rb-1',
          source: 'rollback',
        },
      }),
    });
    expect(stageExecutionDeleteMany).not.toHaveBeenCalled();
    expect(result.stageExecutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'stage-design-1',
          stage: 'DESIGN',
          output: { html: '<div>design</div>' },
        }),
      ]),
    );
  });
});
