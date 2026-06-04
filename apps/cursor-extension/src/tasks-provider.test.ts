import { describe, expect, it } from 'vitest';
import { buildTaskViewModels } from './tasks-model';
import type { FlowXTaskItem } from './flowx-client';

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
