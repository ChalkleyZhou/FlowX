import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHandoffSnapshot, saveRestoredHandoffSnapshot } from './completion-draft';

describe('handoff snapshots', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists the execution session id from a local chat handoff', () => {
    const snapshot = buildHandoffSnapshot({
      chatPrompt: '# FlowX handoff',
      handoff: {
        executionSessionId: 'session-1',
        workflowRepositoryId: 'workflow-repo-1',
        workflowRunId: 'workflow-1',
      },
      taskId: 'req-1',
      taskType: 'requirement',
      workflow: { id: 'workflow-1' },
    });

    expect(snapshot.executionSessionId).toBe('session-1');
  });

  it('persists the execution session id from a claimed handoff', async () => {
    const { promises: fs } = await import('node:fs');
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const writeHandoffSnapshot = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const snapshot = await saveRestoredHandoffSnapshot(
      '/repo',
      {
        eligible: true,
        id: 'req-1',
        repository: null,
        status: 'IN_PROGRESS',
        title: 'Add local handoff',
        type: 'requirement',
        workflowRunId: 'workflow-1',
      },
      {
        executionSessionId: 'session-1',
        requirement: { acceptanceCriteria: '', description: '', id: 'req-1', title: 'Add local handoff' },
        repositories: [{ name: 'FlowX', url: null, workflowRepositoryId: 'workflow-repo-1', workingBranch: 'main' }],
        workflowRunId: 'workflow-1',
      },
    );

    expect(snapshot.executionSessionId).toBe('session-1');
    expect(writeHandoffSnapshot).toHaveBeenCalledWith(
      expect.stringContaining('/repo/.flowx/tasks/req-1.json'),
      expect.stringContaining('"executionSessionId": "session-1"'),
      'utf8',
    );
  });
});
