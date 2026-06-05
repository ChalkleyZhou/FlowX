import type { FlowXTaskItem } from './flowx-client';

type TaskAction = 'start' | 'openChat' | 'copyPrompt' | 'report';

interface TaskActionItem {
  label: string;
  description?: string;
  action: TaskAction;
}

export interface TaskActionDeps {
  showQuickPick(items: TaskActionItem[], placeHolder: string): PromiseLike<TaskActionItem | undefined>;
  startInChat(task: FlowXTaskItem): PromiseLike<void>;
  openChat(task: FlowXTaskItem): PromiseLike<void>;
  copyPrompt(task: FlowXTaskItem): PromiseLike<void>;
  reportCompletion(task: FlowXTaskItem): PromiseLike<void>;
}

export async function showTaskActions(deps: TaskActionDeps, task: FlowXTaskItem): Promise<void> {
  const choice = await deps.showQuickPick(buildTaskActionItems(task), `FlowX: ${task.title}`);
  if (!choice) {
    return;
  }

  if (choice.action === 'start') {
    await deps.startInChat(task);
    return;
  }
  if (choice.action === 'openChat') {
    await deps.openChat(task);
    return;
  }
  if (choice.action === 'copyPrompt') {
    await deps.copyPrompt(task);
    return;
  }
  await deps.reportCompletion(task);
}

function buildTaskActionItems(task: FlowXTaskItem): TaskActionItem[] {
  const items: TaskActionItem[] = [];
  if (!task.workflowRunId && task.eligible) {
    items.push({
      label: 'Start in Chat',
      description: 'Create local handoff and open Cursor Chat',
      action: 'start',
    });
  }
  if (task.workflowRunId) {
    items.push(
      {
        label: 'Open Chat',
        description: 'Open Cursor Chat without submitting completion',
        action: 'openChat',
      },
      {
        label: 'Copy Saved Prompt',
        description: 'Copy the local .flowx prompt created by Start in Chat',
        action: 'copyPrompt',
      },
      {
        label: 'Report Completion',
        description: 'Submit implementation summary and git metadata to FlowX',
        action: 'report',
      },
    );
  }
  if (items.length === 0) {
    items.push({
      label: 'Copy Saved Prompt',
      description: task.ineligibleReason ?? 'Task is not ready to start',
      action: 'copyPrompt',
    });
  }
  return items;
}
