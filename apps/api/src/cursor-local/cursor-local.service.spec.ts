import { describe, expect, it, vi } from 'vitest';
import { CursorLocalService } from './cursor-local.service';

function createService() {
  const prisma = {
    requirement: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    bug: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    workspace: {
      findMany: vi.fn(),
    },
  };
  const workflowService = {
    createLocalChatWorkflowRun: vi.fn(),
    createLocalChatBugWorkflowRun: vi.fn(),
    claimLocalExecution: vi.fn(),
  };

  return {
    service: new CursorLocalService(prisma as never, workflowService as never),
    prisma,
    workflowService,
  };
}

describe('CursorLocalService', () => {
  it('lists eligible local chat requirements and bugs', async () => {
    const { service, prisma } = createService();
    prisma.requirement.findMany.mockResolvedValue([
      {
        id: 'req-1',
        title: 'Export CSV',
        status: 'ACTIVE',
        priority: 'HIGH',
        planningStatus: 'SCHEDULED',
        requirementRepositories: [
          {
            repository: {
              id: 'repo-1',
              name: 'flowx-web',
              url: 'https://github.com/acme/flowx-web.git',
            },
          },
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
        repository: {
          id: 'repo-2',
          name: 'flowx-api',
          url: 'https://github.com/acme/flowx-api.git',
        },
        fixWorkflowRun: null,
      },
    ]);

    const tasks = await service.listTasks({ workspaceId: 'workspace-1' });

    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'req-1',
        type: 'requirement',
        repository: expect.objectContaining({ id: 'repo-1' }),
        eligible: true,
      }),
      expect.objectContaining({
        id: 'bug-1',
        type: 'bug',
        repository: expect.objectContaining({ id: 'repo-2' }),
        eligible: true,
      }),
    ]);
  });

  it('does not require workspaceId when listing tasks for a signed-in user', async () => {
    const { service, prisma } = createService();
    prisma.requirement.findMany.mockResolvedValue([]);
    prisma.bug.findMany.mockResolvedValue([]);

    await service.listTasks({
      session: {
        user: { id: 'user-1', displayName: 'User' },
        organization: { id: 'org-1', name: 'FlowX Org' },
      },
    });

    expect(prisma.workspace.findMany).not.toHaveBeenCalled();
    expect(prisma.requirement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE' },
      }),
    );
    expect(prisma.bug.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['OPEN', 'CONFIRMED'] } },
      }),
    );
  });

  it('only marks local-chat execution-running workflows as reportable', async () => {
    const { service, prisma } = createService();
    prisma.requirement.findMany.mockResolvedValue([
      {
        id: 'req-1',
        title: 'Export CSV',
        status: 'ACTIVE',
        priority: 'HIGH',
        planningStatus: 'SCHEDULED',
        requirementRepositories: [
          {
            repository: {
              id: 'repo-1',
              name: 'flowx-web',
              url: 'https://github.com/acme/flowx-web.git',
            },
          },
        ],
        workflowRuns: [
          {
            id: 'workflow-plan-1',
            runType: 'LOCAL_CHAT',
            status: 'PLAN_PENDING',
            workflowRepositories: [],
          },
          {
            id: 'workflow-local-1',
            runType: 'LOCAL_CHAT',
            status: 'EXECUTION_RUNNING',
            workflowRepositories: [],
          },
        ],
      },
    ]);
    prisma.bug.findMany.mockResolvedValue([
      {
        id: 'bug-1',
        title: 'Login fails',
        status: 'OPEN',
        priority: 'MEDIUM',
        repository: {
          id: 'repo-2',
          name: 'flowx-api',
          url: 'https://github.com/acme/flowx-api.git',
        },
        fixWorkflowRun: {
          id: 'workflow-bug-1',
          runType: 'BUG_FIX',
          status: 'EXECUTION_RUNNING',
        },
      },
    ]);

    const tasks = await service.listTasks({});

    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'req-1',
        eligible: false,
        workflowRunId: 'workflow-local-1',
      }),
      expect.objectContaining({
        id: 'bug-1',
        eligible: false,
        workflowRunId: null,
      }),
    ]);
  });

  it('creates a local chat workflow, claims local execution, and returns a chat prompt', async () => {
    const { service, workflowService } = createService();
    workflowService.createLocalChatWorkflowRun.mockResolvedValue({
      id: 'workflow-1',
      status: 'EXECUTION_PENDING',
    });
    workflowService.claimLocalExecution.mockResolvedValue({
      workflow: { id: 'workflow-1', status: 'EXECUTION_RUNNING' },
      handoff: {
        workflowRunId: 'workflow-1',
        requirement: {
          id: 'req-1',
          title: 'Export CSV',
          description: 'Users need CSV export',
          acceptanceCriteria: 'CSV downloads with headers',
        },
        repositories: [
          {
            name: 'flowx-web',
            url: 'https://github.com/acme/flowx-web.git',
            workingBranch: 'flowx/work/export/workflow-1',
          },
        ],
      },
    });

    const result = await service.startHandoff(
      { taskType: 'requirement', taskId: 'req-1', repositoryIds: ['repo-1'] },
      { user: { id: 'user-1', displayName: 'User' } },
    );

    expect(workflowService.createLocalChatWorkflowRun).toHaveBeenCalledWith({
      requirementId: 'req-1',
      repositoryIds: ['repo-1'],
    });
    expect(workflowService.claimLocalExecution).toHaveBeenCalledWith('workflow-1', {
      user: { id: 'user-1', displayName: 'User' },
    });
    expect(result.chatPrompt).toContain('Cursor Chat');
    expect(result.chatPrompt).toContain('CSV downloads with headers');
  });

  it('creates a local chat bug workflow and returns bug-focused chat prompt', async () => {
    const { service, prisma, workflowService } = createService();
    prisma.bug.findUniqueOrThrow.mockResolvedValue({
      id: 'bug-1',
      title: 'Login fails',
      description: 'Login button returns 500',
      expectedBehavior: 'User reaches dashboard',
      actualBehavior: 'The page shows a 500 toast',
      reproductionSteps: ['Open login page', 'Submit valid credentials'],
    });
    workflowService.createLocalChatBugWorkflowRun.mockResolvedValue({
      id: 'workflow-2',
      status: 'EXECUTION_PENDING',
    });
    workflowService.claimLocalExecution.mockResolvedValue({
      workflow: { id: 'workflow-2', status: 'EXECUTION_RUNNING' },
      handoff: {
        workflowRunId: 'workflow-2',
        requirement: {
          id: 'req-2',
          title: '[BugFix] Login fails',
          description: 'Login button returns 500',
          acceptanceCriteria: 'User reaches dashboard',
        },
        repositories: [
          {
            name: 'flowx-api',
            url: 'https://github.com/acme/flowx-api.git',
            workingBranch: 'flowx/work/login/workflow-2',
          },
        ],
      },
    });

    const result = await service.startHandoff(
      { taskType: 'bug', taskId: 'bug-1', repositoryIds: ['repo-2'] },
      { user: { id: 'user-1', displayName: 'User' } },
    );

    expect(workflowService.createLocalChatBugWorkflowRun).toHaveBeenCalledWith('bug-1', {
      repositoryIds: ['repo-2'],
    });
    expect(result.chatPrompt).toContain('Reproduction');
    expect(result.chatPrompt).toContain('Expected behavior');
    expect(result.chatPrompt).toContain('Submit valid credentials');
  });
});
