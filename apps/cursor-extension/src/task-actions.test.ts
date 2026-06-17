import { describe, expect, it, vi } from 'vitest';
import { showTaskActions } from './task-actions';
import type { FlowXTaskItem } from './flowx-client';

const readyTask: FlowXTaskItem = {
  eligible: true,
  id: 'req-1',
  repository: {
    id: 'repo-1',
    name: 'FlowX',
    url: 'https://github.com/flowx-ai/flowx.git',
  },
  status: 'ACTIVE',
  title: 'Add local handoff',
  type: 'requirement',
  workflowRunId: null,
};

function createDeps(overrides: Partial<Parameters<typeof showTaskActions>[0]> = {}) {
  return {
    copyPrompt: vi.fn(),
    openFlowX: vi.fn(),
    openChat: vi.fn(),
    refreshTasks: vi.fn(),
    reportCompletion: vi.fn(),
    showQuickPick: vi.fn(),
    startInChat: vi.fn(),
    ...overrides,
  };
}

describe('showTaskActions', () => {
  it('starts chat only after the user chooses Start in Chat', async () => {
    const deps = createDeps({
      showQuickPick: vi.fn().mockResolvedValue({ action: 'start' }),
    });

    await showTaskActions(deps, readyTask);

    expect(deps.startInChat).toHaveBeenCalledWith(readyTask);
    expect(deps.refreshTasks).toHaveBeenCalled();
    expect(deps.reportCompletion).not.toHaveBeenCalled();
  });

  it('reports completion only after the user chooses Report Completion', async () => {
    const workingTask = {
      ...readyTask,
      eligible: false,
      workflowRunId: 'workflow-1',
    };
    const deps = createDeps({
      showQuickPick: vi.fn().mockResolvedValue({ action: 'report' }),
    });

    await showTaskActions(deps, workingTask);

    expect(deps.reportCompletion).toHaveBeenCalledWith(workingTask);
    expect(deps.startInChat).not.toHaveBeenCalled();
  });

  it('labels saved local prompts as chat-open actions', async () => {
    const workingTask = {
      ...readyTask,
      eligible: false,
      workflowRunId: 'workflow-1',
    };
    const deps = createDeps({
      showQuickPick: vi.fn().mockResolvedValue(undefined),
    });

    await showTaskActions(deps, workingTask);

    expect(deps.showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Open Prompt in Chat',
        }),
      ]),
      'FlowX: Add local handoff',
    );
  });

  it('offers to open FlowX for blocked tasks without a local handoff', async () => {
    const blockedTask = {
      ...readyTask,
      eligible: false,
      ineligibleReason: 'Active workflow workflow-1 already exists.',
    };
    const deps = createDeps({
      showQuickPick: vi.fn().mockResolvedValue({ action: 'openFlowX' }),
    });

    await showTaskActions(deps, blockedTask);

    expect(deps.openFlowX).toHaveBeenCalledWith(blockedTask);
    expect(deps.copyPrompt).not.toHaveBeenCalled();
  });
});
