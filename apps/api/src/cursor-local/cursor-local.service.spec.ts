import { describe, expect, it, vi } from 'vitest';
import { CursorLocalService } from './cursor-local.service';

function createService() {
  const edgeTasks = {
    listTasks: vi.fn().mockResolvedValue([{ id: 'req-1' }]),
    listWorkflowPositions: vi.fn().mockResolvedValue([{ workflowRunId: 'wf-1', stage: 'spec-plan' }]),
    listOpenDesignTasks: vi.fn().mockResolvedValue([
      {
        kind: 'opendesign-workflow',
        workflowRunId: 'wf-1',
        workItemId: 'req-1',
        title: 'Idea',
        status: 'BRAINSTORM_PENDING',
        suggestedAction: 'brainstorm',
      },
    ]),
  };
  const edgeHandoff = { startHandoff: vi.fn().mockResolvedValue({ executionItemId: 'exec-1' }) };
  const contextPackage = {
    getTaskContext: vi.fn().mockResolvedValue({ id: 'req-1', title: 'Export CSV' }),
  };
  return {
    service: new CursorLocalService(edgeTasks as never, edgeHandoff as never, contextPackage as never),
    edgeTasks,
    edgeHandoff,
    contextPackage,
  };
}

describe('CursorLocalService compatibility layer', () => {
  it('delegates task listing to EdgeTasksService', async () => {
    const { service, edgeTasks } = createService();
    const filters = { workspaceId: 'workspace-1' };

    await expect(service.listTasks(filters)).resolves.toEqual([{ id: 'req-1' }]);
    expect(edgeTasks.listTasks).toHaveBeenCalledWith(filters);
  });

  it('delegates OpenDesign task listing to EdgeTasksService', async () => {
    const { service, edgeTasks } = createService();
    const filters = { workspaceId: 'workspace-1' };

    await expect(service.listOpenDesignTasks(filters)).resolves.toEqual([
      expect.objectContaining({ kind: 'opendesign-workflow', workflowRunId: 'wf-1' }),
    ]);
    expect(edgeTasks.listOpenDesignTasks).toHaveBeenCalledWith(filters);
  });

  it('delegates workflow position lookup to EdgeTasksService', async () => {
    const { service, edgeTasks } = createService();
    const filters = { workflowRunId: 'wf-1' };

    await expect(service.listWorkflowPositions(filters)).resolves.toEqual([
      expect.objectContaining({ workflowRunId: 'wf-1', stage: 'spec-plan' }),
    ]);
    expect(edgeTasks.listWorkflowPositions).toHaveBeenCalledWith(filters);
  });

  it('maps cursor-local handoff to sourceTool=cursor', async () => {
    const { service, edgeHandoff } = createService();
    await service.startHandoff({ executionItemId: 'exec-1', claimKey: 'claim-1' });

    expect(edgeHandoff.startHandoff).toHaveBeenCalledWith(
      { executionItemId: 'exec-1', claimKey: 'claim-1', sourceTool: 'cursor' },
      undefined,
    );
  });

  it('keeps the legacy raw task context response', async () => {
    const { service, contextPackage } = createService();
    await expect(service.getTaskContext('exec-1')).resolves.toEqual({
      id: 'req-1',
      title: 'Export CSV',
    });
    expect(contextPackage.getTaskContext).toHaveBeenCalledWith('exec-1');
  });
});
