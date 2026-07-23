import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowXToolHandlers } from './tools.js';

describe('createFlowXToolHandlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists tasks through the FlowX API client', async () => {
    const apiClient = {
      listTasks: vi.fn().mockResolvedValue([{ id: 'req-1' }]),
    };
    const handlers = createFlowXToolHandlers({
      apiClient: apiClient as never,
      collectGitReport: vi.fn() as never,
    });

    const result = await handlers.flowx_list_tasks({ workspaceId: 'workspace-1' });

    expect(apiClient.listTasks).toHaveBeenCalledWith('workspace-1');
    expect(result.content[0]?.text).toContain('req-1');
  });

  it('returns a tool error when completion has no changed files', async () => {
    const handlers = createFlowXToolHandlers({
      apiClient: {} as never,
      collectGitReport: vi.fn().mockResolvedValue({
        branch: 'main',
        headSha: 'abc',
        changedFiles: [],
        untrackedFiles: [],
        diffSummary: '',
        dirty: false,
      }),
    });

    const result = await handlers.flowx_report_completion({
      workflowRunId: 'workflow-1',
      workflowRepositoryId: 'wr-1',
      implementationSummary: 'No changes',
      testResult: 'Not run',
      pushed: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No changed files');
  });

  it('reports completion with collected git state', async () => {
    const apiClient = {
      completeLocal: vi.fn().mockResolvedValue({ workflow: { id: 'workflow-1' } }),
    };
    const handlers = createFlowXToolHandlers({
      apiClient: apiClient as never,
      collectGitReport: vi.fn().mockResolvedValue({
        branch: 'flowx/work/task/12345678',
        headSha: 'abcdef',
        changedFiles: ['src/App.tsx'],
        untrackedFiles: ['src/new.ts'],
        diffSummary: '1 file changed',
        dirty: true,
      }),
    });

    const result = await handlers.flowx_report_completion({
      workflowRunId: 'workflow-1',
      workflowRepositoryId: 'wr-1',
      implementationSummary: 'Done',
      testResult: 'Tests passed',
      pushed: true,
      cwd: '/repo',
    });

    expect(apiClient.completeLocal).toHaveBeenCalledWith('workflow-1', {
      pushed: true,
      implementationSummary: 'Done',
      testResult: 'Tests passed',
      diffSummary: '1 file changed',
      untrackedFiles: ['src/new.ts'],
      repositories: [
        {
          workflowRepositoryId: 'wr-1',
          headSha: 'abcdef',
          changedFiles: ['src/App.tsx'],
          patchSummary: 'Done',
        },
      ],
    });
    expect(result.content[0]?.text).toContain('workflow-1');
  });

  it('prefers session completion when an execution session id is supplied', async () => {
    const apiClient = {
      completeExecutionSession: vi.fn().mockResolvedValue({ workflow: { id: 'workflow-1' } }),
      completeLocal: vi.fn(),
    };
    const handlers = createFlowXToolHandlers({
      apiClient: apiClient as never,
      collectGitReport: vi.fn().mockResolvedValue({
        branch: 'flowx/work/task/12345678',
        headSha: 'abcdef',
        changedFiles: ['src/App.tsx'],
        untrackedFiles: [],
        diffSummary: '1 file changed',
        dirty: true,
      }),
    });

    await handlers.flowx_report_completion({
      workflowRunId: 'workflow-1',
      workflowRepositoryId: 'wr-1',
      executionSessionId: 'session-1',
      idempotencyKey: 'local:session-1:abcdef',
      implementationSummary: 'Done',
      testResult: 'Tests passed',
      pushed: true,
    });

    expect(apiClient.completeExecutionSession).toHaveBeenCalledWith('session-1', {
      idempotencyKey: 'local:session-1:abcdef',
      pushed: true,
      implementationSummary: 'Done',
      testResult: 'Tests passed',
      diffSummary: '1 file changed',
      untrackedFiles: [],
      repositories: [
        {
          workflowRepositoryId: 'wr-1',
          headSha: 'abcdef',
          changedFiles: ['src/App.tsx'],
          patchSummary: 'Done',
        },
      ],
    });
    expect(apiClient.completeLocal).not.toHaveBeenCalled();
  });

  it('falls back to legacy completion and warns without an execution session id', async () => {
    const apiClient = {
      completeLocal: vi.fn().mockResolvedValue({ workflow: { id: 'workflow-1' } }),
    };
    const handlers = createFlowXToolHandlers({
      apiClient: apiClient as never,
      collectGitReport: vi.fn().mockResolvedValue({
        branch: 'flowx/work/task/12345678',
        headSha: 'abcdef',
        changedFiles: ['src/App.tsx'],
        untrackedFiles: [],
        diffSummary: '1 file changed',
        dirty: true,
      }),
    });

    const result = await handlers.flowx_report_completion({
      workflowRunId: 'workflow-1',
      workflowRepositoryId: 'wr-1',
      implementationSummary: 'Done',
      testResult: 'Tests passed',
      pushed: true,
    });

    expect(apiClient.completeLocal).toHaveBeenCalledOnce();
    expect(result.content[0]?.text).toContain('executionSessionId');
  });

  it('reports progress and evidence through execution session APIs', async () => {
    const apiClient = {
      appendExecutionEvent: vi.fn().mockResolvedValue({ ok: true }),
      registerEvidence: vi.fn().mockResolvedValue({ ok: true }),
    };
    const handlers = createFlowXToolHandlers({
      apiClient: apiClient as never,
      collectGitReport: vi.fn() as never,
    });

    await handlers.flowx_report_progress({
      executionSessionId: 'session-1',
      message: 'Running tests',
      idempotencyKey: 'progress-1',
    });
    await handlers.flowx_report_evidence({
      executionSessionId: 'session-1',
      evidenceType: 'TEST_RESULT',
      summary: 'All tests passed',
      idempotencyKey: 'evidence-1',
    });

    expect(apiClient.appendExecutionEvent).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        eventType: 'execution.progressed',
        idempotencyKey: 'progress-1',
        payload: { message: 'Running tests' },
      }),
    );
    expect(apiClient.registerEvidence).toHaveBeenCalledWith('session-1', {
      evidenceType: 'TEST_RESULT',
      sourceTool: 'cursor',
      title: 'All tests passed',
      summary: 'All tests passed',
      metadata: { idempotencyKey: 'evidence-1' },
    });
  });

  it('loads the active design session and fetches its handoff', async () => {
    const apiClient = {
      getDesignHandoff: vi.fn().mockResolvedValue({
        executionSessionId: 'session-1',
        contextPackage: { requirement: { title: 'Export' } },
      }),
    };
    const handlers = createFlowXToolHandlers({
      apiClient: apiClient as never,
      collectGitReport: vi.fn() as never,
      readActiveDesignSession: async () => ({
        workflowRunId: 'workflow-1',
        executionSessionId: 'session-1',
        apiBaseUrl: 'http://127.0.0.1:3000',
        accessToken: 'token-1',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      }),
      resolveDesignClient: async () => apiClient as never,
    });

    const active = await handlers.flowx_get_active_design_session({});
    expect(active.content[0]?.text).toContain('workflow-1');

    const handoff = await handlers.flowx_get_design_handoff({});
    expect(apiClient.getDesignHandoff).toHaveBeenCalledWith('workflow-1');
    expect(handoff.content[0]?.text).toContain('Export');
  });

  it('submits a design report for the active execution session', async () => {
    const apiClient = {
      submitDesign: vi.fn().mockResolvedValue({ ok: true }),
    };
    const handlers = createFlowXToolHandlers({
      apiClient: apiClient as never,
      collectGitReport: vi.fn() as never,
      readActiveDesignSession: async () => ({
        workflowRunId: 'workflow-1',
        executionSessionId: 'session-1',
        apiBaseUrl: 'http://127.0.0.1:3000',
        accessToken: 'token-1',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      }),
      resolveDesignClient: async () => apiClient as never,
    });

    const result = await handlers.flowx_submit_design({
      report: {
        idempotencyKey: 'design:session-1:v1',
        summary: 'Done',
        output: {
          design: { overview: 'A' },
          demo: { summary: 'B' },
          designArtifact: { html: '<!doctype html><html><body>Hi</body></html>' },
        },
      },
    });

    expect(apiClient.submitDesign).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ idempotencyKey: 'design:session-1:v1' }),
    );
    expect(result.isError).toBeUndefined();
  });

  it('submits brainstorm markdown for the active execution session', async () => {
    const apiClient = {
      submitBrainstorm: vi.fn().mockResolvedValue({ ok: true }),
    };
    const handlers = createFlowXToolHandlers({
      apiClient: apiClient as never,
      collectGitReport: vi.fn() as never,
      readActiveDesignSession: async () => ({
        workflowRunId: 'workflow-1',
        executionSessionId: 'session-1',
        apiBaseUrl: 'http://127.0.0.1:3000',
        accessToken: 'token-1',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        stage: 'brainstorm' as const,
        updatedAt: '2026-07-22T00:00:00.000Z',
      }),
      resolveDesignClient: async () => apiClient as never,
    });

    const result = await handlers.flowx_submit_brainstorm({
      report: {
        idempotencyKey: 'brainstorm:session-1:v1',
        markdown: '# Brief\n\nUser stories...',
      },
    });

    expect(apiClient.submitBrainstorm).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ markdown: '# Brief\n\nUser stories...' }),
    );
    expect(result.isError).toBeUndefined();
  });
});
