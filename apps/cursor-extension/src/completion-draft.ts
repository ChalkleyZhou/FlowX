import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CompleteLocalInput, FlowXTaskItem, LocalChatHandoff, LocalHandoffPayload } from './flowx-client';

export interface HandoffSnapshot {
  taskId: string;
  taskType: 'requirement' | 'bug';
  workflowRunId: string;
  workflowRepositoryId: string | null;
}

export function buildHandoffSnapshot(handoff: LocalChatHandoff): HandoffSnapshot {
  return {
    taskId: handoff.taskId,
    taskType: handoff.taskType,
    workflowRunId: handoff.handoff.workflowRunId,
    workflowRepositoryId:
      handoff.handoff.workflowRepositoryId ?? handoff.handoff.repositories?.[0]?.workflowRepositoryId ?? null,
  };
}

export async function saveHandoffSnapshot(gitRoot: string, handoff: LocalChatHandoff): Promise<string> {
  const snapshot = buildHandoffSnapshot(handoff);
  return writeHandoffSnapshot(gitRoot, snapshot);
}

export async function saveRestoredHandoffSnapshot(
  gitRoot: string,
  task: FlowXTaskItem,
  handoff: LocalHandoffPayload,
): Promise<HandoffSnapshot> {
  const snapshot: HandoffSnapshot = {
    taskId: task.id,
    taskType: task.type,
    workflowRunId: handoff.workflowRunId,
    workflowRepositoryId: handoff.repositories?.[0]?.workflowRepositoryId ?? null,
  };
  await writeHandoffSnapshot(gitRoot, snapshot);
  return snapshot;
}

async function writeHandoffSnapshot(gitRoot: string, snapshot: HandoffSnapshot): Promise<string> {
  const dir = path.join(gitRoot, '.flowx', 'tasks');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${sanitizeFileName(snapshot.taskId)}.json`);
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return filePath;
}

export async function loadHandoffSnapshot(gitRoot: string, taskId: string): Promise<HandoffSnapshot | null> {
  try {
    const filePath = path.join(gitRoot, '.flowx', 'tasks', `${sanitizeFileName(taskId)}.json`);
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as HandoffSnapshot;
  } catch {
    return null;
  }
}

export async function saveCompletionDraft(
  gitRoot: string,
  workflowRunId: string,
  payload: CompleteLocalInput,
): Promise<string> {
  const dir = path.join(gitRoot, '.flowx', 'completion-drafts');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${sanitizeFileName(workflowRunId)}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}
