import type { FlowXTaskItem, LocalHandoffPayload } from './flowx-client';

export interface ClaimLocalDeps {
  claimLocal(runId: string): Promise<unknown>;
  getLocalHandoff(runId: string): Promise<LocalHandoffPayload>;
  getGitRoot(): Promise<string | null>;
  buildPrompt(task: FlowXTaskItem, handoff: LocalHandoffPayload): string;
  writeTaskFile(gitRoot: string, taskId: string, content: string): Promise<string>;
  saveHandoff(gitRoot: string, task: FlowXTaskItem, handoff: LocalHandoffPayload): Promise<unknown>;
  copyToClipboard(content: string): Promise<void>;
  openPromptInChat(prompt: string): Promise<boolean>;
  showError(message: string): void;
  showInfo(message: string): void;
}

/**
 * Claim local execution on an existing workflow run, then hand the confirmed-plan prompt to the local agent.
 * Unlike `startInChat` (which creates a LOCAL_CHAT run via /cursor-local/handoff), this drives an existing
 * full workflow run that is already at EXECUTION_PENDING via /execution/claim-local.
 */
export async function claimAndHandoffLocalExecution(deps: ClaimLocalDeps, task: FlowXTaskItem): Promise<void> {
  if (!task.workflowRunId) {
    deps.showError('当前任务没有关联的 workflow run，无法接管本地执行。');
    return;
  }

  const gitRoot = await deps.getGitRoot();
  if (!gitRoot) {
    deps.showError('请先打开与任务仓库匹配的本地 Git 工作区，再接管本地执行。');
    return;
  }

  await deps.claimLocal(task.workflowRunId);
  const handoff = await deps.getLocalHandoff(task.workflowRunId);
  const prompt = deps.buildPrompt(task, handoff);
  const filePath = await deps.writeTaskFile(gitRoot, task.id, prompt);
  await deps.saveHandoff(gitRoot, task, handoff);
  await deps.copyToClipboard(prompt);
  const opened = await deps.openPromptInChat(prompt);
  deps.showInfo(
    opened
      ? `已接管本地执行，prompt 已在 Chat 打开并保存到 ${filePath}`
      : `已接管本地执行，prompt 已复制并保存到 ${filePath}`,
  );
}
