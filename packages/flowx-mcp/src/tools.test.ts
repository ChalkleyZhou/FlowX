import { describe, expect, it, vi } from 'vitest';
import { createFlowXToolHandlers } from './tools.js';

describe('createFlowXToolHandlers', () => {
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
});
