import { describe, expect, it, vi } from 'vitest';
import { buildTaskViewModels } from './tasks-model';
import type { FlowXTaskItem } from './flowx-client';
import { FlowXTasksProvider } from './tasks-provider';

vi.mock('./config', () => ({
  getFlowXConfig: vi.fn(async () => ({
    apiBaseUrl: 'http://127.0.0.1:3000',
    apiToken: 'token-1',
  })),
}));

vi.mock('./repo-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./repo-match')>();
  return {
    ...actual,
    getOriginRemoteUrl: vi.fn(async () => 'git@github.com:flowx-ai/flowx.git'),
    getWorkspaceGitRoot: vi.fn(async () => '/workspace/repo'),
    resolveWorkspacePath: vi.fn(() => '/workspace/repo'),
  };
});

const baseTask: FlowXTaskItem = {
  eligible: true,
  id: 'req-1',
  priority: 'HIGH',
  repository: {
    id: 'repo-1',
    name: 'FlowX',
    url: 'https://github.com/flowx-ai/flowx.git',
  },
  scheduleSignal: 'READY',
  status: 'ACTIVE',
  title: 'Add local handoff',
  type: 'requirement',
  workflowRunId: null,
};

describe('buildTaskViewModels', () => {
  it('marks matching eligible tasks as startable', () => {
    expect(buildTaskViewModels([baseTask], 'git@github.com:flowx-ai/flowx.git')).toEqual([
      expect.objectContaining({
        contextValue: 'flowxTask.startable',
        description: 'requirement / ACTIVE / FlowX',
        label: 'Add local handoff',
        startable: true,
      }),
    ]);
  });

  it('blocks tasks from a different local repository', () => {
    expect(buildTaskViewModels([baseTask], 'git@github.com:flowx-ai/other.git')).toEqual([
      expect.objectContaining({
        contextValue: 'flowxTask.blocked',
        startable: false,
        tooltip: expect.stringContaining('Expected github.com/flowx-ai/flowx'),
      }),
    ]);
  });

  it('preserves FlowX ineligible reasons', () => {
    const ineligibleTask = {
      ...baseTask,
      eligible: false,
      ineligibleReason: 'Active workflow already exists.',
    };

    expect(buildTaskViewModels([ineligibleTask], 'git@github.com:flowx-ai/flowx.git')).toEqual([
      expect.objectContaining({
        contextValue: 'flowxTask.blocked',
        startable: false,
        tooltip: 'Active workflow already exists.',
      }),
    ]);
  });

  it('marks tasks with active workflow runs as reportable', () => {
    const runningTask = {
      ...baseTask,
      eligible: false,
      ineligibleReason: 'Active workflow already exists.',
      workflowRunId: 'workflow-1',
    };

    expect(buildTaskViewModels([runningTask], 'git@github.com:flowx-ai/flowx.git')).toEqual([
      expect.objectContaining({
        contextValue: 'flowxTask.reportable',
        reportable: true,
        startable: false,
      }),
    ]);
  });
});

describe('FlowXTasksProvider', () => {
  function createVscodeMock() {
    return {
      EventEmitter: class {
        event = vi.fn();
        fire = vi.fn();
      },
      TreeItem: class {
        description?: string;
        tooltip?: string;
        contextValue?: string;
        command?: unknown;

        constructor(
          public label: string,
          public collapsibleState: number,
        ) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/workspace/repo' } }],
      },
    };
  }

  it('offers to open FlowX requirements when no local-chat tasks exist', async () => {
    const vscode = createVscodeMock();
    const context = {} as never;
    const provider = new FlowXTasksProvider(vscode as never, context, () => ({
      listTasks: async () => [],
    }) as never);

    const [item] = await provider.getChildren();

    expect(item.label).toBe('No FlowX tasks. Create a requirement or bug in FlowX.');
    expect(item.command).toEqual({
      command: 'flowx.openRequirements',
      title: 'Open FlowX Requirements',
    });
  });

  it('opens an action menu when a task is selected', async () => {
    const vscode = createVscodeMock();
    const context = {} as never;
    const provider = new FlowXTasksProvider(vscode as never, context, () => ({
      listTasks: async () => [baseTask],
    }) as never);

    const [item] = await provider.getChildren();

    expect(item.command).toEqual({
      command: 'flowx.showTaskActions',
      title: 'FlowX Task Actions',
      arguments: [baseTask],
    });
  });
});
