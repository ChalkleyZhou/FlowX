import * as vscode from 'vscode';
import {
  loadHandoffSnapshot,
  saveCompletionDraft,
  saveHandoffSnapshot,
  saveRestoredHandoffSnapshot,
} from './completion-draft';
import { collectGitCompletionReport, getCurrentGitRoot, reportCompletion } from './completion-panel';
import { completeFlowXSignIn, configureFlowX, getFlowXConfig, signOutFromFlowX } from './config';
import { buildFlowXWebUrl } from './config-model';
import type { FlowXTaskItem } from './flowx-client';
import { FlowXClient } from './flowx-client';
import {
  buildPromptFromLocalHandoff,
  getLocalGitReport,
  readTaskPromptFile,
  startInChat,
  writeTaskPromptFile,
} from './handoff';
import { showTaskActions } from './task-actions';
import { FlowXTasksProvider } from './tasks-provider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new FlowXTasksProvider(vscode, context);
  const startTaskInChat = async (task: FlowXTaskItem) => {
    const config = await getFlowXConfig(context);
    if (!config) {
      vscode.window.showErrorMessage('Configure FlowX before starting local chat.');
      return;
    }
    const client = new FlowXClient(config);
    await startInChat(
      {
        copyToClipboard: (content) => vscode.env.clipboard.writeText(content),
        executeCommand: (command) => vscode.commands.executeCommand(command),
        getGitReport: () => getLocalGitReport(vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath)),
        showError: (message) => vscode.window.showErrorMessage(message),
        showInfo: (message) => vscode.window.showInformationMessage(message),
        showWarning: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
        startHandoff: (input) => client.startHandoff(input),
        saveHandoffSnapshot,
        writeTaskFile: writeTaskPromptFile,
      },
      task,
    );
  };
  const reportTaskCompletion = async (task: FlowXTaskItem) => {
    const config = await getFlowXConfig(context);
    if (!config) {
      vscode.window.showErrorMessage('Configure FlowX before reporting completion.');
      return;
    }
    const client = new FlowXClient(config);
    await reportCompletion(
      {
        collectGitReport: collectGitCompletionReport,
        completeLocal: (workflowRunId, input) => client.completeLocal(workflowRunId, input),
        getGitRoot: () => getCurrentGitRoot(vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath)),
        loadHandoffSnapshot,
        restoreHandoffSnapshot: async (gitRoot, currentTask) => {
          if (!currentTask.workflowRunId) {
            return null;
          }
          const handoff = await client.getLocalHandoff(currentTask.workflowRunId);
          return saveRestoredHandoffSnapshot(gitRoot, currentTask, handoff);
        },
        saveCompletionDraft,
        showError: (message) => vscode.window.showErrorMessage(message),
        showInfo: (message) => vscode.window.showInformationMessage(message),
        showInput: (prompt) => vscode.window.showInputBox({ ignoreFocusOut: true, prompt }),
        showQuickPick: (items, placeHolder) => vscode.window.showQuickPick(items, { ignoreFocusOut: true, placeHolder }),
        showWarning: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
      },
      task,
    );
  };
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        await completeFlowXSignIn(context, uri);
        provider.refresh();
      },
    }),
    vscode.window.registerTreeDataProvider('flowxTasks', provider),
    vscode.commands.registerCommand('flowx.configure', () => configureFlowX(context)),
    vscode.commands.registerCommand('flowx.signOut', async () => {
      await signOutFromFlowX(context);
      provider.refresh();
    }),
    vscode.commands.registerCommand('flowx.refreshTasks', () => provider.refresh()),
    vscode.commands.registerCommand('flowx.openRequirements', async () => {
      const config = await getFlowXConfig(context);
      const apiBaseUrl = config?.apiBaseUrl ?? 'http://127.0.0.1:3000';
      await vscode.env.openExternal(vscode.Uri.parse(buildFlowXWebUrl(apiBaseUrl, '/requirements', process.env)));
    }),
    vscode.commands.registerCommand('flowx.showTaskActions', (task: FlowXTaskItem) =>
      showTaskActions(
        {
          copyPrompt: async (currentTask) => {
            const gitRoot = await getCurrentGitRoot(vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath));
            if (!gitRoot) {
              vscode.window.showErrorMessage('Open a local Git repository workspace before copying the FlowX prompt.');
              return;
            }
            let prompt = await readTaskPromptFile(gitRoot, currentTask.id);
            if (!prompt && currentTask.workflowRunId) {
              const config = await getFlowXConfig(context);
              if (config) {
                const handoff = await new FlowXClient(config).getLocalHandoff(currentTask.workflowRunId);
                prompt = buildPromptFromLocalHandoff(currentTask, handoff);
                await writeTaskPromptFile(gitRoot, currentTask.id, prompt);
                await saveRestoredHandoffSnapshot(gitRoot, currentTask, handoff);
              }
            }
            if (!prompt) {
              vscode.window.showErrorMessage(
                'No saved FlowX prompt was copied. Use Start in Chat once to create .flowx/tasks prompt metadata.',
              );
              return;
            }
            await vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage('FlowX prompt copied.');
          },
          openChat: async () => {
            await vscode.commands.executeCommand('workbench.action.chat.open');
          },
          reportCompletion: reportTaskCompletion,
          showQuickPick: (items, placeHolder) => vscode.window.showQuickPick(items, { ignoreFocusOut: true, placeHolder }),
          startInChat: startTaskInChat,
        },
        task,
      ),
    ),
    vscode.commands.registerCommand('flowx.startInChat', startTaskInChat),
    vscode.commands.registerCommand('flowx.reportCompletion', reportTaskCompletion),
  );
}

export function deactivate() {}
