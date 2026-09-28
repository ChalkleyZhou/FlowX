import { describe, expect, it, vi } from 'vitest';
import { EdgeTasksService } from './edge-tasks.service';

function createService() {
  const prisma = {
    requirement: { findMany: vi.fn() },
    bug: { findMany: vi.fn() },
    workflowRun: { findMany: vi.fn() },
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

  it('exposes a running local Spec & Plan session in Cursor tasks', async () => {
    const { service, prisma } = createService();
    prisma.requirement.findMany.mockResolvedValue([{ id: 'req-1', title: 'Plan export', status: 'ACTIVE',
      requirementRepositories: [{ repository: { id: 'repo-1', name: 'web', url: 'https://example.com/web.git' } }],
      workflowRuns: [{ id: 'workflow-spec', runType: 'FULL', status: 'SPEC_PLAN_PENDING',
        executionSessions: [{ id: 'session-spec', sourceTool: 'flowx-local', status: 'RUNNING',
          metadata: { stage: 'SPEC_PLAN' } }],
      }],
    }]);
    prisma.bug.findMany.mockResolvedValue([]);

    const [task] = await service.listTasks({});

    expect(task).toEqual(expect.objectContaining({
      workflowRunId: 'workflow-spec', executionSessionId: 'session-spec',
      workflowStage: 'SPEC_PLAN', eligible: false,
    }));
  });

  it('lists OpenDesign candidates with suggestedAction from status', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([
      {
        id: 'wf-brain',
        status: 'BRAINSTORM_PENDING',
        requirementId: 'req-brain',
        requirement: { id: 'req-brain', title: 'Brainstorm idea' },
      },
      {
        id: 'wf-design',
        status: 'DESIGN_PENDING',
        requirementId: 'req-design',
        requirement: { id: 'req-design', title: 'Design ready' },
      },
    ]);

    const items = await service.listOpenDesignTasks({
      workspaceId: 'workspace-1',
      session: {
        user: { id: 'user-1', displayName: 'Ada' },
        organization: { id: 'org-1', name: 'Acme' },
      },
    });

    expect(items).toEqual([
      {
        kind: 'opendesign-workflow',
        workflowRunId: 'wf-brain',
        requirementId: 'req-brain',
        title: 'Brainstorm idea',
        status: 'BRAINSTORM_PENDING',
        suggestedAction: 'brainstorm',
      },
      {
        kind: 'opendesign-workflow',
        workflowRunId: 'wf-design',
        requirementId: 'req-design',
        title: 'Design ready',
        status: 'DESIGN_PENDING',
        suggestedAction: 'design',
      },
    ]);
    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          runType: { in: ['LOCAL_DESIGN', 'FULL'] },
          status: { in: ['BRAINSTORM_PENDING', 'DESIGN_PENDING'] },
          requirement: { workspaceId: 'workspace-1' },
          OR: [
            { executionSessions: { none: {} } },
            { executionSessions: { some: { organizationId: 'org-1' } } },
          ],
        }),
      }),
    );
  });

  it('omits organization filter when authSession has no organization', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([]);

    await service.listOpenDesignTasks({
      session: { user: { id: 'user-1', displayName: 'Ada' }, organization: null },
    });

    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          runType: { in: ['LOCAL_DESIGN', 'FULL'] },
          status: { in: ['BRAINSTORM_PENDING', 'DESIGN_PENDING'] },
        },
      }),
    );
  });

  it('returns the live stage and prior outputs for a workflow handed to another person', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([
      {
        id: 'workflow-spec',
        status: 'SPEC_PLAN_PENDING',
        requirement: { id: 'req-1', title: 'Export CSV' },
        stageExecutions: [
          {
            id: 'stage-prd',
            stage: 'BRAINSTORM',
            status: 'COMPLETED',
            attempt: 1,
            output: { markdown: '# Export PRD' },
          },
          {
            id: 'stage-design',
            stage: 'DESIGN',
            status: 'COMPLETED',
            attempt: 1,
            output: { markdown: '# Export design' },
          },
        ],
        artifacts: [{ id: 'artifact-design', artifactType: 'DESIGN_HTML', name: 'Web端/index.html' }],
      },
    ]);

    await expect(service.listWorkflowPositions({ workflowRunId: 'workflow-spec' })).resolves.toEqual([
      expect.objectContaining({
        workflowRunId: 'workflow-spec',
        title: 'Export CSV',
        status: 'SPEC_PLAN_PENDING',
        localAction: 'generate',
        stage: 'spec-plan',
        outputContract: expect.objectContaining({ files: ['spec.md', 'plan.md', 'spec-plan.json'] }),
        priorOutputs: [
          expect.objectContaining({ stage: 'brainstorm', summary: '# Export PRD' }),
          expect.objectContaining({ stage: 'design', summary: '# Export design' }),
        ],
        artifacts: [{ id: 'artifact-design', artifactType: 'DESIGN_HTML', name: 'Web端/index.html' }],
      }),
    ]);
    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'workflow-spec' },
      }),
    );
  });

  it('hides finished workflows from the open position list', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([]);

    await service.listWorkflowPositions({ workspaceId: 'workspace-1' });

    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { notIn: ['DONE', 'FAILED'] },
          requirement: { workspaceId: 'workspace-1' },
        },
      }),
    );
  });

  it('rejects an unknown workflow id', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([]);

    await expect(service.listWorkflowPositions({ workflowRunId: 'missing' })).rejects.toThrow(
      /missing/,
    );
  });
});
