import type { FlowXTaskItem } from './flowx-client';
import { matchRepository } from './repo-match';

export interface FlowXTaskViewModel {
  task: FlowXTaskItem;
  label: string;
  description: string;
  tooltip: string;
  contextValue: 'flowxTask.startable' | 'flowxTask.blocked';
  startable: boolean;
}

export function buildTaskViewModels(tasks: FlowXTaskItem[], currentRemoteUrl: string | null): FlowXTaskViewModel[] {
  return tasks.map((task) => {
    const description = `${task.type} / ${task.status} / ${task.repository?.name ?? 'No repository'}`;
    const repositoryMatch = matchRepository(task.repository?.url, currentRemoteUrl);
    const blockedReason = getBlockedReason(task, repositoryMatch);

    return {
      task,
      label: task.title,
      description,
      tooltip: blockedReason ?? buildTaskTooltip(task, repositoryMatch.expectedRemote),
      contextValue: blockedReason ? 'flowxTask.blocked' : 'flowxTask.startable',
      startable: !blockedReason,
    };
  });
}

function getBlockedReason(
  task: FlowXTaskItem,
  repositoryMatch: ReturnType<typeof matchRepository>,
): string | null {
  if (!task.eligible) {
    return task.ineligibleReason ?? 'This FlowX task is not eligible for local chat.';
  }
  if (!repositoryMatch.expectedRemote) {
    return 'This FlowX task has no repository URL.';
  }
  if (!repositoryMatch.currentRemote) {
    return 'Open a local Git repository with an origin remote.';
  }
  if (!repositoryMatch.match) {
    return `Repository mismatch. Expected ${repositoryMatch.expectedRemote}, current ${repositoryMatch.currentRemote}.`;
  }
  return null;
}

function buildTaskTooltip(task: FlowXTaskItem, expectedRemote: string | null): string {
  return [
    `${task.type}: ${task.title}`,
    `Status: ${task.status}`,
    expectedRemote ? `Repository: ${expectedRemote}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
