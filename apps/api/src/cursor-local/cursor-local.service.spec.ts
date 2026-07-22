import { describe, expect, it, vi } from 'vitest';
import { CursorLocalService } from './cursor-local.service';

function createService() {
  const edgeTasks = { listTasks: vi.fn().mockResolvedValue([{ id: 'req-1' }]) };
  const edgeHandoff = { startHandoff: vi.fn().mockResolvedValue({ taskId: 'req-1' }) };
  const contextPackage = {
    getLegacyTaskContext: vi.fn().mockResolvedValue({ id: 'req-1', title: 'Export CSV' }),
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

  it('maps cursor-local handoff to sourceTool=cursor', async () => {
    const { service, edgeHandoff } = createService();
    await service.startHandoff({ taskType: 'requirement', taskId: 'req-1' });

    expect(edgeHandoff.startHandoff).toHaveBeenCalledWith(
      { taskType: 'requirement', taskId: 'req-1', sourceTool: 'cursor' },
      undefined,
    );
  });

  it('keeps the legacy raw task context response', async () => {
    const { service, contextPackage } = createService();
    await expect(service.getTaskContext('requirement', 'req-1')).resolves.toEqual({
      id: 'req-1',
      title: 'Export CSV',
    });
    expect(contextPackage.getLegacyTaskContext).toHaveBeenCalledWith('requirement', 'req-1');
  });
});
