import { describe, expect, it, vi } from 'vitest';
import { CursorLocalController } from './cursor-local.controller';

describe('CursorLocalController workflow position', () => {
  it('forwards the authenticated user and organization to position lookup', async () => {
    const service = { listWorkflowPositions: vi.fn().mockResolvedValue([]) };
    const controller = new CursorLocalController(service as never);
    const authSession = { user: { id: 'user-1', displayName: '用户' }, organization: { id: 'org-1' } };
    await controller.listWorkflowPositions('workspace-1', 'workflow-1', { authSession });
    expect(service.listWorkflowPositions).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', workflowRunId: 'workflow-1', session: authSession,
    });
  });
});
