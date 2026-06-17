import type { FlowXTaskItem } from './flowx-client';

type TaskAction = 'start' | 'openChat' | 'copyPrompt' | 'report' | 'openFlowX';

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
  openFlowX(task: FlowXTaskItem): PromiseLike<void>;
  refreshTasks?(): void;
  reportCompletion(task: FlowXTaskItem): PromiseLike<void>;
}

export async function showTaskActions(deps: TaskActionDeps, task: FlowXTaskItem): Promise<void> {
  const choice = await deps.showQuickPick(buildTaskActionItems(task), `FlowX: ${task.title}`);
  if (!choice) {
    return;
  }

  if (choice.action === 'start') {
    await deps.startInChat(task);
    deps.refreshTasks?.();
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
  if (choice.action === 'openFlowX') {
    await deps.openFlowX(task);
    return;
  }
  await deps.reportCompletion(task);
  deps.refreshTasks?.();
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
        label: 'Open Prompt in Chat',
        description: 'Open the saved .flowx prompt in Cursor Chat',
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
      label: 'Open FlowX',
      description: task.ineligibleReason ?? 'Task is not ready to start',
      action: 'openFlowX',
    });
  }
  return items;
}
