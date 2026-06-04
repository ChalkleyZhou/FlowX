import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FlowXTaskItem, LocalChatHandoff, StartLocalChatInput } from './flowx-client';
import {
  getOriginRemoteUrl,
  getWorkspaceGitRoot,
  matchRepository,
  resolveWorkspacePath,
} from './repo-match';

const execFileAsync = promisify(execFile);
const CONTINUE = 'Continue';

export interface LocalGitReport {
  gitRoot: string | null;
  currentRemoteUrl: string | null;
  dirty: boolean;
}

export interface StartInChatDeps {
  getGitReport(): Promise<LocalGitReport>;
  showWarning(message: string, ...items: string[]): PromiseLike<string | undefined>;
  showError(message: string): void;
  showInfo(message: string): void;
  startHandoff(input: StartLocalChatInput): Promise<LocalChatHandoff>;
  writeTaskFile(gitRoot: string, taskId: string, content: string): Promise<string>;
  copyToClipboard(content: string): PromiseLike<void>;
  executeCommand(command: string): PromiseLike<unknown>;
}

export async function startInChat(deps: StartInChatDeps, task: FlowXTaskItem): Promise<void> {
  const gitReport = await deps.getGitReport();
  if (!gitReport.gitRoot) {
    deps.showError('Open a local Git repository workspace before starting FlowX local chat.');
    return;
  }

  const repositoryMatch = matchRepository(task.repository?.url, gitReport.currentRemoteUrl);
  if (!repositoryMatch.match) {
    deps.showError(
      `Repository mismatch. Expected ${repositoryMatch.expectedRemote ?? 'unknown'}, current ${repositoryMatch.currentRemote ?? 'unknown'}.`,
    );
    return;
  }

  if (gitReport.dirty) {
    const choice = await deps.showWarning(
      'This repository has uncommitted changes. Continue starting FlowX local chat?',
      CONTINUE,
      'Cancel',
    );
    if (choice !== CONTINUE) {
      return;
    }
  }

  const handoff = await deps.startHandoff({
    taskType: task.type,
    taskId: task.id,
    repositoryIds: task.repository?.id ? [task.repository.id] : undefined,
  });
  const filePath = await deps.writeTaskFile(gitReport.gitRoot, task.id, handoff.chatPrompt);
  await deps.copyToClipboard(handoff.chatPrompt);
  try {
    await deps.executeCommand('workbench.action.chat.open');
  } catch {
    // Cursor/VS Code variants may expose different chat commands; clipboard is the reliable handoff.
  }
  deps.showInfo(`FlowX prompt copied and saved to ${filePath}.`);
}

export async function getLocalGitReport(workspacePaths: readonly string[] | undefined): Promise<LocalGitReport> {
  const workspacePath = resolveWorkspacePath(workspacePaths);
  if (!workspacePath) {
    return { currentRemoteUrl: null, dirty: false, gitRoot: null };
  }

  const gitRoot = await getWorkspaceGitRoot(workspacePath);
  if (!gitRoot) {
    return { currentRemoteUrl: null, dirty: false, gitRoot: null };
  }

  const currentRemoteUrl = await getOriginRemoteUrl(gitRoot);
  const dirty = await isGitWorkingTreeDirty(gitRoot);
  return { currentRemoteUrl, dirty, gitRoot };
}

export async function writeTaskPromptFile(gitRoot: string, taskId: string, content: string): Promise<string> {
  const taskDir = path.join(gitRoot, '.flowx', 'tasks');
  await fs.mkdir(taskDir, { recursive: true });
  const filePath = path.join(taskDir, `${sanitizeTaskId(taskId)}.md`);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

async function isGitWorkingTreeDirty(gitRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: gitRoot });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._-]/g, '-');
}
