import { describe, expect, it, vi } from 'vitest';
import { reportCompletion } from './completion-panel';
import type { FlowXTaskItem } from './flowx-client';

const task: FlowXTaskItem = {
  eligible: false,
  id: 'req-1',
  repository: {
    id: 'repo-1',
    name: 'FlowX',
    url: 'https://github.com/flowx-ai/flowx.git',
  },
  status: 'IN_PROGRESS',
  title: 'Add local handoff',
  type: 'requirement',
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
    completeLocal: vi.fn().mockResolvedValue({ workflow: { id: 'workflow-1' } }),
    completeExecutionSession: vi.fn().mockResolvedValue({ workflow: { id: 'workflow-1' } }),
    getGitRoot: vi.fn().mockResolvedValue('/repo/flowx'),
    loadHandoffSnapshot: vi.fn().mockResolvedValue({
      executionSessionId: null,
      taskId: 'req-1',
      taskType: 'requirement',
      workflowRepositoryId: 'workflow-repo-1',
      workflowRunId: 'workflow-1',
    }),
    restoreHandoffSnapshot: vi.fn(),
    saveCompletionDraft: vi.fn(),
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

    expect(deps.completeLocal).toHaveBeenCalledWith('workflow-1', {
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

  it('prefers session complete when the task has an execution session id', async () => {
    const completeExecutionSession = vi.fn().mockResolvedValue({ workflow: { id: 'workflow-1' } });
    const deps = createDeps({ completeExecutionSession });
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
    expect(deps.completeLocal).not.toHaveBeenCalled();
  });

  it('uses completeLocal legacy route when no execution session id exists', async () => {
    const completeExecutionSession = vi.fn();
    const deps = createDeps({ completeExecutionSession });

    await reportCompletion(deps, task);

    expect(deps.completeLocal).toHaveBeenCalled();
    expect(completeExecutionSession).not.toHaveBeenCalled();
  });

  it.each([404, 405])('shows a protocol unsupported error for session complete HTTP %i', async (status) => {
    const completeExecutionSession = vi.fn().mockRejectedValue(new Error(`FlowX request failed with status ${status}`));
    const deps = createDeps({ completeExecutionSession });

    await reportCompletion(deps, { ...task, executionSessionId: 'session-1' });

    expect(deps.completeLocal).not.toHaveBeenCalled();
    expect(deps.saveCompletionDraft).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalledWith(expect.stringMatching(/protocol unsupported/i));
  });

  it('shows an offline retry error without creating a session completion draft', async () => {
    const completeExecutionSession = vi.fn().mockRejectedValue(new Error('API unavailable'));
    const deps = createDeps({ completeExecutionSession });

    await reportCompletion(deps, { ...task, executionSessionId: 'session-1' });

    expect(deps.saveCompletionDraft).not.toHaveBeenCalled();
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

    expect(deps.completeLocal).not.toHaveBeenCalled();
  });

  it('saves a completion draft when FlowX submission fails', async () => {
    const deps = createDeps({
      completeLocal: vi.fn().mockRejectedValue(new Error('API unavailable')),
    });

    await reportCompletion(deps, task);

    expect(deps.saveCompletionDraft).toHaveBeenCalledWith('/repo/flowx', 'workflow-1', expect.any(Object));
    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('API unavailable'));
  });

  it('restores missing handoff metadata before reporting completion', async () => {
    const deps = createDeps({
      loadHandoffSnapshot: vi.fn().mockResolvedValue(null),
      restoreHandoffSnapshot: vi.fn().mockResolvedValue({
        executionSessionId: null,
        taskId: 'req-1',
        taskType: 'requirement',
        workflowRepositoryId: 'workflow-repo-1',
        workflowRunId: 'workflow-1',
      }),
    });

    await reportCompletion(deps, task);

    expect(deps.restoreHandoffSnapshot).toHaveBeenCalledWith('/repo/flowx', task);
    expect(deps.completeLocal).toHaveBeenCalledWith('workflow-1', expect.objectContaining({
      repositories: [
        expect.objectContaining({
          workflowRepositoryId: 'workflow-repo-1',
        }),
      ],
    }));
  });
});
