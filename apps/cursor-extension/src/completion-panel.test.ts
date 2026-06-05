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
    getGitRoot: vi.fn().mockResolvedValue('/repo/flowx'),
    loadHandoffSnapshot: vi.fn().mockResolvedValue({
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
