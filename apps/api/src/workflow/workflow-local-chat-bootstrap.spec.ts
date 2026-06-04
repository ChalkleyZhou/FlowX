import { describe, expect, it, vi } from 'vitest';
import { StageExecutionStatus, StageType, WorkflowRunStatus, WorkflowRunType } from '../common/enums';
import { WorkflowService } from './workflow.service';

function createService() {
  const service = new WorkflowService(
    {} as never,
    {
      canBootstrapLocalChatWorkflow: vi.fn().mockReturnValue(true),
    } as never,
    {} as never,
    {} as never,
    {
      normalizeAiProvider: () => 'codex',
      getConfiguredDefaultProvider: () => 'codex' as const,
      resolveInvocationContext: async () => ({}),
    } as never,
    { get: () => ({}) } as never,
    {} as never,
    {} as never,
  );

  let stageId = 0;
  vi.spyOn(service as never, 'createStageExecution' as never).mockImplementation(
    async (_tx: unknown, _workflowId: string, stage: StageType, payload: { status: StageExecutionStatus }) => ({
      id: `${stage}-${payload.status}-${stageId++}`,
    }),
  );
  vi.spyOn(service as never, 'updateStageExecution' as never).mockResolvedValue(undefined);
  vi.spyOn(service as never, 'transitionWorkflow' as never).mockResolvedValue(undefined);

  return service;
}

describe('WorkflowService local chat bootstrap', () => {
  it('prepares confirmed local chat task and plan without starting execution', async () => {
    const service = createService();
    const tx = {
      task: {
        create: vi.fn().mockResolvedValue({ id: 'task-1' }),
      },
      plan: {
        create: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      },
    };

    await (
      service as unknown as {
        applyLocalChatBootstrap: (
          tx: typeof tx,
          workflow: {
            id: string;
            runType: WorkflowRunType;
            requirement: {
              id: string;
              title: string;
              description: string;
              acceptanceCriteria: string;
            };
          },
          repositoryNames: string[],
        ) => Promise<void>;
      }
    ).applyLocalChatBootstrap(
      tx,
      {
        id: 'workflow-1',
        runType: WorkflowRunType.LOCAL_CHAT,
        requirement: {
          id: 'req-1',
          title: 'Add export',
          description: 'Users need CSV export',
          acceptanceCriteria: 'CSV downloads with headers',
        },
      },
      ['flowx-web'],
    );

    expect(tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowRunId: 'workflow-1',
        title: 'Add export',
        surface: 'local_chat',
        repositoryNames: ['flowx-web'],
        status: 'CONFIRMED',
      }),
    });
    expect(tx.plan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowRunId: 'workflow-1',
        status: 'CONFIRMED',
        summary: '本地 Chat 实现：Add export',
      }),
    });
    expect(
      vi.mocked((service as never).transitionWorkflow).mock.calls.some(
        ([, workflowId, from, transition]) =>
          workflowId === 'workflow-1' &&
          from === WorkflowRunStatus.PLAN_CONFIRMED &&
          transition.to === WorkflowRunStatus.EXECUTION_PENDING,
      ),
    ).toBe(true);
    expect(
      vi.mocked((service as never).createStageExecution).mock.calls.some(
        ([, workflowId, stage, payload]) =>
          workflowId === 'workflow-1' &&
          stage === StageType.TASK_SPLIT &&
          payload.input.requirementId === 'req-1',
      ),
    ).toBe(true);
    expect(
      vi.mocked((service as never).createStageExecution).mock.calls.some(
        ([, , stage, payload]) =>
          stage === StageType.EXECUTION && payload.status === StageExecutionStatus.RUNNING,
      ),
    ).toBe(false);
  });
});
