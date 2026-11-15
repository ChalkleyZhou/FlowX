import { describe, expect, it, vi } from 'vitest';
import { reportCompletion } from './completion-panel';
import type { FlowXTaskItem } from './flowx-client';

const task: FlowXTaskItem = {
  eligible: false,
  id: 'req-1',
  workItemId: 'work-1',
  kind: 'REQUIREMENT',
  workItemTitle: '导出 CSV',
  repository: {
    id: 'repo-1',
    name: 'FlowX',
    url: 'https://github.com/flowx-ai/flowx.git',
  },
  status: 'IN_PROGRESS',
  title: 'Add local handoff',
  workflowRunId: 'workflow-1',
};

function createDeps(overrides: Partial<Parameters<typeof reportCompletion>[0]> = {}) {
  return {
    collectGitReport: vi.fn().mockResolvedValue({
      branch: 'feat/local-chat',
      changedFiles: ['apps/web/src/App.tsx'],
      diffSummary: '1 file changed',
      dirty: true,
      headSha: 'abc123',
      untrackedFiles: ['notes.txt'],
    }),
    completeExecutionSession: vi.fn().mockResolvedValue({ workflow: { id: 'workflow-1' } }),
    getGitRoot: vi.fn().mockResolvedValue('/repo/flowx'),
    loadHandoffSnapshot: vi.fn().mockResolvedValue({
      executionSessionId: 'session-1',
      executionItemId: 'req-1',
      workItemId: 'work-1',
      workflowRepositoryId: 'workflow-repo-1',
      workflowRunId: 'workflow-1',
    }),
    restoreHandoffSnapshot: vi.fn(),
    showError: vi.fn(),
    showInfo: vi.fn(),
    showInput: vi.fn().mockResolvedValueOnce('Implemented local handoff').mockResolvedValueOnce('pnpm test passed'),
    showQuickPick: vi.fn().mockResolvedValue('No'),
    showWarning: vi.fn().mockResolvedValue('Continue'),
    ...overrides,
  };
}

describe('reportCompletion', () => {
  it('submits local completion metadata to FlowX', async () => {
    const deps = createDeps();

    await reportCompletion(deps, task);

    expect(deps.completeExecutionSession).toHaveBeenCalledWith('session-1', {
      diffSummary: '1 file changed',
      implementationSummary: 'Implemented local handoff',
      pushed: false,
      repositories: [
        {
          changedFiles: ['apps/web/src/App.tsx'],
          headSha: 'abc123',
          patchSummary: 'Implemented local handoff',
          workflowRepositoryId: 'workflow-repo-1',
        },
      ],
      testResult: 'pnpm test passed',
      untrackedFiles: ['notes.txt'],
    });
  });

  it('uses the execution session from the task when the snapshot has none', async () => {
    const completeExecutionSession = vi.fn().mockResolvedValue({ workflow: { id: 'workflow-1' } });
    const deps = createDeps({
      completeExecutionSession,
      loadHandoffSnapshot: vi.fn().mockResolvedValue({
        executionSessionId: null,
        executionItemId: 'req-1',
        workItemId: 'work-1',
        workflowRepositoryId: 'workflow-repo-1',
        workflowRunId: 'workflow-1',
      }),
    });
    const sessionTask = { ...task, executionSessionId: 'session-1' };

    await reportCompletion(deps, sessionTask);

    expect(completeExecutionSession).toHaveBeenCalledWith('session-1', {
      diffSummary: '1 file changed',
      implementationSummary: 'Implemented local handoff',
      pushed: false,
      repositories: [
        {
          changedFiles: ['apps/web/src/App.tsx'],
          headSha: 'abc123',
          patchSummary: 'Implemented local handoff',
          workflowRepositoryId: 'workflow-repo-1',
        },
      ],
      testResult: 'pnpm test passed',
      untrackedFiles: ['notes.txt'],
    });
  });

  it('rejects completion when no execution session id exists', async () => {
    const deps = createDeps({
      loadHandoffSnapshot: vi.fn().mockResolvedValue({
        executionSessionId: null,
        executionItemId: 'req-1',
        workItemId: 'work-1',
        workflowRepositoryId: 'workflow-repo-1',
        workflowRunId: 'workflow-1',
      }),
    });

    await reportCompletion(deps, task);

    expect(deps.completeExecutionSession).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalledWith(expect.stringMatching(/execution session is missing/i));
  });

  it.each([404, 405])('shows a protocol unsupported error for session complete HTTP %i', async (status) => {
    const completeExecutionSession = vi.fn().mockRejectedValue(new Error(`FlowX request failed with status ${status}`));
    const deps = createDeps({ completeExecutionSession });

    await reportCompletion(deps, { ...task, executionSessionId: 'session-1' });

    expect(deps.showError).toHaveBeenCalledWith(expect.stringMatching(/protocol unsupported/i));
  });

  it('shows an offline retry error without creating a session completion draft', async () => {
    const completeExecutionSession = vi.fn().mockRejectedValue(new Error('API unavailable'));
    const deps = createDeps({ completeExecutionSession });

    await reportCompletion(deps, { ...task, executionSessionId: 'session-1' });

    expect(deps.showError).toHaveBeenCalledWith(expect.stringMatching(/API unavailable; retry when online/i));
  });

  it('does not submit when there are no changed files and the user cancels', async () => {
    const deps = createDeps({
      collectGitReport: vi.fn().mockResolvedValue({
        branch: 'feat/local-chat',
        changedFiles: [],
        diffSummary: '',
        dirty: false,
        headSha: 'abc123',
        untrackedFiles: [],
      }),
      showWarning: vi.fn().mockResolvedValue('Cancel'),
    });

    await reportCompletion(deps, task);

    expect(deps.completeExecutionSession).not.toHaveBeenCalled();
  });

  it('reports the session submission failure', async () => {
    const deps = createDeps({
      completeExecutionSession: vi.fn().mockRejectedValue(new Error('API unavailable')),
    });

    await reportCompletion(deps, task);

    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('API unavailable'));
  });

  it('restores missing handoff metadata before reporting completion', async () => {
    const deps = createDeps({
      loadHandoffSnapshot: vi.fn().mockResolvedValue(null),
      restoreHandoffSnapshot: vi.fn().mockResolvedValue({
        executionSessionId: 'session-restored',
        executionItemId: 'req-1',
        workItemId: 'work-1',
        workflowRepositoryId: 'workflow-repo-1',
        workflowRunId: 'workflow-1',
      }),
    });

    await reportCompletion(deps, task);

    expect(deps.restoreHandoffSnapshot).toHaveBeenCalledWith('/repo/flowx', task);
    expect(deps.completeExecutionSession).toHaveBeenCalledWith('session-restored', expect.objectContaining({
      repositories: [
        expect.objectContaining({
          workflowRepositoryId: 'workflow-repo-1',
        }),
      ],
    }));
  });
});
