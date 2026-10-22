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
            output: { markdown: '# Export design', surfaces: [{ id: 'web', pages: [
              { id: 'index', relPath: 'workflow-spec/web/index.html' },
            ] }] },
          },
        ],
        artifacts: [{ id: 'artifact-design', artifactType: 'DESIGN_HTML', name: 'Web端/index.html',
          storageKey: 'design/workflow-spec/web/index.html' }],
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


describe('EdgeTasksService workflow position ownership', () => {
  const auth = { user: { id: 'user-current', displayName: '当前用户' }, organization: { id: 'org-1' } };
  const stage = { id: 'stage-current', stage: 'SPEC_PLAN', status: 'RUNNING', attempt: 2 };
  const currentSession = {
    id: 'session-current', stageExecutionId: stage.id, status: 'RUNNING', executorType: 'LOCAL',
    organizationId: 'org-1', claimedByUserId: 'user-other',
    claimedByUser: { id: 'user-other', displayName: '其他执行人' },
    metadata: { stage: 'SPEC_PLAN' },
  };
  function workflow(overrides: Record<string, unknown> = {}) {
    return { id: 'wf-1', status: 'SPEC_PLAN_PENDING',
      requirement: { id: 'req-1', title: '需求', project: { workspace: { organizationId: 'org-1' } } },
      stageExecutions: [stage], executionSessions: [currentSession], artifacts: [], ...overrides };
  }

  it('blocks another user and provides the current session and owner', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow()]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position).toMatchObject({ localAction: 'none', outputContract: null,
      executionSession: { id: currentSession.id, claimedByUserId: 'user-other',
        claimedByUser: { displayName: '其他执行人' } } });
    expect(position.message).toMatch(/等待.*其他执行人/);
  });

  it('allows the claimed user to continue their current attempt', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow({ executionSessions: [
      { ...currentSession, claimedByUserId: auth.user.id, claimedByUser: auth.user },
    ] })]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position.localAction).toBe('generate');
    expect(position.outputContract?.files).toEqual(['spec.md', 'plan.md', 'spec-plan.json']);
  });

  it.each([undefined, { user: { id: '', displayName: '' } }])('does not grant occupied work to an anonymous caller', async (session) => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow()]);
    const [position] = await service.listWorkflowPositions({ session });
    expect(position).toMatchObject({ localAction: 'none', outputContract: null });
  });

  it('requires administrator recovery for a session with no recorded owner', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow({ executionSessions: [
      { ...currentSession, claimedByUserId: null, claimedByUser: null },
    ] })]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position).toMatchObject({ localAction: 'none', outputContract: null });
    expect(position.message).toMatch(/管理员.*恢复|管理员.*交接/);
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'])('ignores terminal session %s', async (status) => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow({ executionSessions: [{ ...currentSession, status }] })]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position.localAction).toBe('generate');
    expect(position.executionSession).toBeNull();
  });

  it('ignores active sessions linked to an older attempt or another stage', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow({
      stageExecutions: [{ ...stage, id: 'stage-old', attempt: 1 }, stage,
        { id: 'design-stage', stage: 'DESIGN', status: 'COMPLETED', attempt: 3 }],
      executionSessions: [
        { ...currentSession, id: 'old-session', stageExecutionId: 'stage-old' },
        { ...currentSession, id: 'design-session', stageExecutionId: 'design-stage', metadata: { stage: 'DESIGN' } },
      ],
    })]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position.localAction).toBe('generate');
    expect(position.executionSession).toBeNull();
  });

  it('keeps web confirmation authoritative even for the session owner', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow({ status: 'SPEC_PLAN_WAITING_CONFIRMATION',
      stageExecutions: [{ ...stage, status: 'WAITING_CONFIRMATION' }],
      executionSessions: [{ ...currentSession, claimedByUserId: auth.user.id, claimedByUser: auth.user }],
    })]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position).toMatchObject({ localAction: 'wait_for_confirmation', outputContract: null });
  });

  it('scopes workflow lookup by organization in addition to a requested id and workspace', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([]);
    await expect(service.listWorkflowPositions({ workflowRunId: 'foreign-wf', workspaceId: 'workspace-1', session: auth }))
      .rejects.toThrow(/not found/);
    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'foreign-wf', requirement: {
        workspaceId: 'workspace-1', project: { workspace: { organizationId: 'org-1' } },
      } },
      include: expect.objectContaining({ executionSessions: expect.objectContaining({
        select: expect.objectContaining({ claimedByUserId: true, stageExecutionId: true }),
      }) }),
    }));
  });

  it('does not offer artifacts from rejected or unconfirmed latest attempts', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow({
      stageExecutions: [stage,
        { id: 'design-old', stage: 'DESIGN', status: 'COMPLETED', attempt: 1 },
        { id: 'design-current', stage: 'DESIGN', status: 'REJECTED', attempt: 2 }],
      artifacts: [
        { id: 'design-old-file', artifactType: 'DESIGN_HTML', name: '旧设计',
          executionSession: { stageExecutionId: 'design-old' } },
        { id: 'draft-spec', artifactType: 'SPEC_MARKDOWN', name: '待确认方案',
          executionSession: { stageExecutionId: stage.id } },
      ],
    })]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position.artifacts).toEqual([]);
    expect(position.priorOutputs).toEqual([]);
  });

  it('returns artifact references only for the latest confirmed attempt', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow({
      stageExecutions: [stage,
        { id: 'design-old', stage: 'DESIGN', status: 'COMPLETED', attempt: 1 },
        { id: 'design-current', stage: 'DESIGN', status: 'COMPLETED', attempt: 2 }],
      artifacts: [
        { id: 'old-file', artifactType: 'DESIGN_HTML', name: '旧设计', executionSession: { stageExecutionId: 'design-old' } },
        { id: 'unknown-file', artifactType: 'DESIGN_HTML', name: '无法确认版本的历史设计' },
        { id: 'current-file', artifactType: 'DESIGN_HTML', name: '已确认设计', executionSession: { stageExecutionId: 'design-current' } },
      ],
    })]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position.artifacts).toEqual([
      { id: 'current-file', artifactType: 'DESIGN_HTML', name: '已确认设计' },
    ]);
  });

  it('keeps sessionless design HTML from the confirmed second attempt inventory', async () => {
    const { service, prisma } = createService();
    const generatedAt = '2026-10-22T04:00:00.000Z';
    const relPath = 'wf-1/web/index-2026-10-22T04-00-00-000Z.html';
    prisma.workflowRun.findMany.mockResolvedValue([workflow({
      stageExecutions: [stage,
        { id: 'design-old', stage: 'DESIGN', status: 'COMPLETED', attempt: 1 },
        { id: 'design-current', stage: 'DESIGN', status: 'COMPLETED', attempt: 2,
          output: { surfaces: [{ id: 'web', pages: [{ id: 'index', relPath, generatedAt, bytes: 100 }] }] } }],
      artifacts: [
        { id: 'old-file', artifactType: 'DESIGN_HTML', name: '旧设计',
          storageKey: 'design/wf-1/web/index-old.html', version: '2026-10-21T04:00:00.000Z',
          metadata: { generatedAt: '2026-10-21T04:00:00.000Z', surfaceId: 'web', pageId: 'index' } },
        { id: 'unknown-file', artifactType: 'DESIGN_HTML', name: '无法证明版本的历史设计' },
        { id: 'current-file', artifactType: 'DESIGN_HTML', name: '已确认设计',
          storageKey: `design/${relPath}`, version: generatedAt,
          metadata: { generatedAt, surfaceId: 'web', pageId: 'index' } },
      ],
    })]);

    const [position] = await service.listWorkflowPositions({ session: auth });

    expect(position.artifacts).toEqual([
      { id: 'current-file', artifactType: 'DESIGN_HTML', name: '已确认设计' },
    ]);
    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ artifacts: expect.objectContaining({
        select: expect.objectContaining({ storageKey: true, version: true, metadata: true }),
      }) }),
    }));
  });

  it.each(['version', 'metadata'])('matches sessionless inventory by %s generation and page identity', async (generationSource) => {
    const { service, prisma } = createService();
    const generatedAt = '2026-10-22T04:00:00.000Z';
    const metadata = { surfaceId: 'web', pageId: 'index',
      ...(generationSource === 'metadata' ? { generatedAt } : {}) };
    prisma.workflowRun.findMany.mockResolvedValue([workflow({
      stageExecutions: [stage,
        { id: 'design-current', stage: 'DESIGN', status: 'COMPLETED', attempt: 2,
          output: { surfaces: [{ id: 'web', pages: [{ id: 'index', generatedAt }] }] } }],
      artifacts: [
        { id: 'current-file', artifactType: 'DESIGN_HTML', name: '已确认设计',
          version: generationSource === 'version' ? generatedAt : '1', metadata },
        { id: 'other-page', artifactType: 'DESIGN_HTML', name: '其他页面',
          version: generatedAt, metadata: { generatedAt, surfaceId: 'web', pageId: 'other' } },
        { id: 'other-surface', artifactType: 'DESIGN_HTML', name: '其他端',
          version: generatedAt, metadata: { generatedAt, surfaceId: 'mobile', pageId: 'index' } },
      ],
    })]);

    const [position] = await service.listWorkflowPositions({ session: auth });

    expect(position.artifacts).toEqual([
      { id: 'current-file', artifactType: 'DESIGN_HTML', name: '已确认设计' },
    ]);
  });

  it('does not fall back to an old inventory when the latest confirmed design has no pages', async () => {
    const { service, prisma } = createService();
    const relPath = 'wf-1/web/index-old.html';
    prisma.workflowRun.findMany.mockResolvedValue([workflow({
      stageExecutions: [stage,
        { id: 'design-old', stage: 'DESIGN', status: 'COMPLETED', attempt: 1,
          output: { surfaces: [{ id: 'web', pages: [{ id: 'index', relPath }] }] } },
        { id: 'design-current', stage: 'DESIGN', status: 'COMPLETED', attempt: 2,
          output: { markdown: '# 已确认的新设计' } }],
      artifacts: [{ id: 'old-file', artifactType: 'DESIGN_HTML', name: '旧设计', storageKey: `design/${relPath}` }],
    })]);

    const [position] = await service.listWorkflowPositions({ session: auth });

    expect(position.artifacts).toEqual([]);
  });

  it('does not offer sessionless design HTML without inventory evidence even on the first attempt', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow({
      stageExecutions: [stage,
        { id: 'design-current', stage: 'DESIGN', status: 'COMPLETED', attempt: 1,
          output: { markdown: '# 已确认的设计' } }],
      artifacts: [{ id: 'unknown-file', artifactType: 'DESIGN_HTML', name: '无法证明版本的历史设计' }],
    })]);

    const [position] = await service.listWorkflowPositions({ session: auth });

    expect(position.artifacts).toEqual([]);
  });

  it.each(['REJECTED', 'WAITING_CONFIRMATION', 'FAILED'])('does not reuse old HTML while the latest design is %s', async (status) => {
    const { service, prisma } = createService();
    const relPath = 'wf-1/web/index.html';
    const output = { surfaces: [{ id: 'web', pages: [{ id: 'index', relPath }] }] };
    prisma.workflowRun.findMany.mockResolvedValue([workflow({
      stageExecutions: [stage,
        { id: 'design-old', stage: 'DESIGN', status: 'COMPLETED', attempt: 1, output },
        { id: 'design-current', stage: 'DESIGN', status, attempt: 2, output }],
      artifacts: [{ id: 'design-file', artifactType: 'DESIGN_HTML', name: '设计', storageKey: `design/${relPath}` }],
    })]);

    const [position] = await service.listWorkflowPositions({ session: auth });

    expect(position.artifacts).toEqual([]);
  });

  it('permits a new user to take the next stage after upstream confirmation', async () => {
    const { service, prisma } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([workflow({ status: 'SPEC_PLAN_CONFIRMED',
      stageExecutions: [{ ...stage, status: 'COMPLETED', output: { spec: { goal: '已确认方案' } } },
        { id: 'execution-stage', stage: 'EXECUTION', status: 'PENDING', attempt: 1 }],
      executionSessions: [{ ...currentSession, status: 'COMPLETED' }],
    })]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position).toMatchObject({ localAction: 'generate', stage: 'execution',
      priorOutputs: [expect.objectContaining({ stage: 'spec-plan', summary: '已确认方案' })] });
  });
  it('keeps an inherited page explicitly retained by the current confirmed inventory', async () => {
    const { service, prisma } = createService();
    const relPath = 'wf-1/mobile/retained.html';
    prisma.workflowRun.findMany.mockResolvedValue([workflow({
      stageExecutions: [stage, { id: 'design-current', stage: 'DESIGN', status: 'COMPLETED', attempt: 2,
        output: { surfaces: [{ id: 'mobile', pages: [{ id: 'retained', relPath }] }] } }],
      artifacts: [{ id: 'inherited', artifactType: 'DESIGN_HTML', name: '保留的移动页面',
        storageKey: `design/${relPath}`, executionSession: { stageExecutionId: 'design-old' } }],
    })]);
    const [position] = await service.listWorkflowPositions({ session: auth });
    expect(position.artifacts).toEqual([{ id: 'inherited', artifactType: 'DESIGN_HTML', name: '保留的移动页面' }]);
  });

});
