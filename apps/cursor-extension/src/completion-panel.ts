import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CompleteLocalInput, FlowXTaskItem } from './flowx-client';
import type { HandoffSnapshot } from './completion-draft';
import { getWorkspaceGitRoot, resolveWorkspacePath } from './repo-match';

const execFileAsync = promisify(execFile);
const CONTINUE = 'Continue';

export interface GitCompletionReport {
  branch: string;
  headSha: string;
  changedFiles: string[];
  untrackedFiles: string[];
  diffSummary: string;
  dirty: boolean;
}

export interface ReportCompletionDeps {
  getGitRoot(): Promise<string | null>;
  collectGitReport(gitRoot: string): Promise<GitCompletionReport>;
  loadHandoffSnapshot(gitRoot: string, taskId: string): Promise<HandoffSnapshot | null>;
  restoreHandoffSnapshot?(gitRoot: string, task: FlowXTaskItem): Promise<HandoffSnapshot | null>;
  completeLocal(workflowRunId: string, input: CompleteLocalInput): Promise<unknown>;
  saveCompletionDraft(gitRoot: string, workflowRunId: string, payload: CompleteLocalInput): Promise<unknown>;
  showInput(prompt: string): PromiseLike<string | undefined>;
  showQuickPick(items: string[], placeHolder: string): PromiseLike<string | undefined>;
  showWarning(message: string, ...items: string[]): PromiseLike<string | undefined>;
  showError(message: string): void;
  showInfo(message: string): void;
}

export async function reportCompletion(deps: ReportCompletionDeps, task: FlowXTaskItem): Promise<void> {
  const gitRoot = await deps.getGitRoot();
  if (!gitRoot) {
    deps.showError('Open a local Git repository workspace before reporting FlowX completion.');
    return;
  }

  const snapshot = (await deps.loadHandoffSnapshot(gitRoot, task.id)) ?? (await deps.restoreHandoffSnapshot?.(gitRoot, task));
  const workflowRunId = snapshot?.workflowRunId ?? task.workflowRunId;
  const workflowRepositoryId = snapshot?.workflowRepositoryId;
  if (!workflowRunId || !workflowRepositoryId) {
    deps.showError('FlowX handoff metadata is missing. Start this task in chat before reporting completion.');
    return;
  }

  const implementationSummary = await deps.showInput('Implementation summary');
  if (!implementationSummary) {
    return;
  }
  const testResult = await deps.showInput('Test result');
  if (!testResult) {
    return;
  }
  const pushedChoice = await deps.showQuickPick(['No', 'Yes'], 'Did you push the branch?');
  if (!pushedChoice) {
    return;
  }

  const report = await deps.collectGitReport(gitRoot);
  if (report.changedFiles.length === 0) {
    const choice = await deps.showWarning(
      'No changed files were found. Continue reporting completion?',
      CONTINUE,
      'Cancel',
    );
    if (choice !== CONTINUE) {
      return;
    }
  }

  const payload: CompleteLocalInput = {
    pushed: pushedChoice === 'Yes',
    implementationSummary,
    testResult,
    diffSummary: report.diffSummary,
    untrackedFiles: report.untrackedFiles,
    repositories: [
      {
        workflowRepositoryId,
        headSha: report.headSha,
        changedFiles: report.changedFiles,
        patchSummary: implementationSummary,
      },
    ],
  };

  try {
    await deps.completeLocal(workflowRunId, payload);
    deps.showInfo('FlowX completion reported.');
  } catch (error) {
    await deps.saveCompletionDraft(gitRoot, workflowRunId, payload);
    const message = error instanceof Error ? error.message : 'FlowX completion submission failed.';
    deps.showError(`FlowX completion draft saved. ${message}`);
  }
}

export async function getCurrentGitRoot(workspacePaths: readonly string[] | undefined): Promise<string | null> {
  const workspacePath = resolveWorkspacePath(workspacePaths);
  return workspacePath ? getWorkspaceGitRoot(workspacePath) : null;
}

export async function collectGitCompletionReport(gitRoot: string): Promise<GitCompletionReport> {
  const [branch, headSha, changedText, untrackedText, diffSummary, statusText] = await Promise.all([
    git(gitRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(gitRoot, ['rev-parse', 'HEAD']),
    git(gitRoot, ['diff', '--name-only', 'HEAD']),
    git(gitRoot, ['ls-files', '--others', '--exclude-standard']),
    git(gitRoot, ['diff', '--stat', 'HEAD']),
    git(gitRoot, ['status', '--porcelain']),
  ]);

  return {
    branch,
    headSha,
    changedFiles: lines(changedText),
    untrackedFiles: lines(untrackedText),
    diffSummary,
    dirty: statusText.trim().length > 0,
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
