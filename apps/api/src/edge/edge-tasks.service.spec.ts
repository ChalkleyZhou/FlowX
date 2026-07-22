import { describe, expect, it, vi } from 'vitest';
import { EdgeTasksService } from './edge-tasks.service';

function createService() {
  const prisma = {
    requirement: { findMany: vi.fn() },
    bug: { findMany: vi.fn() },
  };
  return { service: new EdgeTasksService(prisma as never), prisma };
}

describe('EdgeTasksService', () => {
  it('applies the shared Requirement/Bug eligibility rules', async () => {
    const { service, prisma } = createService();
    prisma.requirement.findMany.mockResolvedValue([
      {
        id: 'req-1',
        title: 'Export CSV',
        status: 'ACTIVE',
        priority: 'HIGH',
        planningStatus: 'SCHEDULED',
        requirementRepositories: [
          { repository: { id: 'repo-1', name: 'web', url: 'https://example.com/web.git' } },
        ],
        workflowRuns: [],
      },
    ]);
    prisma.bug.findMany.mockResolvedValue([
      {
        id: 'bug-1',
        title: 'Login fails',
        status: 'OPEN',
        priority: 'MEDIUM',
        repository: { id: 'repo-2', name: 'api', url: null },
        fixWorkflowRun: null,
      },
    ]);

    const tasks = await service.listTasks({ workspaceId: 'workspace-1' });

    expect(tasks).toEqual([
      expect.objectContaining({ id: 'req-1', type: 'requirement', eligible: true }),
      expect.objectContaining({ id: 'bug-1', type: 'bug', eligible: true }),
    ]);
    expect(prisma.requirement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE', workspaceId: 'workspace-1' } }),
    );
  });

  it('exposes only running LOCAL_CHAT workflows as reportable', async () => {
    const { service, prisma } = createService();
    prisma.requirement.findMany.mockResolvedValue([
      {
        id: 'req-1',
        title: 'Export CSV',
        status: 'ACTIVE',
        priority: 'HIGH',
        planningStatus: 'SCHEDULED',
        requirementRepositories: [
          { repository: { id: 'repo-1', name: 'web', url: null } },
        ],
        workflowRuns: [
          { id: 'workflow-1', runType: 'LOCAL_CHAT', status: 'EXECUTION_RUNNING' },
        ],
      },
    ]);
    prisma.bug.findMany.mockResolvedValue([]);

    const tasks = await service.listTasks({});

    expect(tasks[0]).toEqual(
      expect.objectContaining({ eligible: false, workflowRunId: 'workflow-1' }),
    );
  });
});
