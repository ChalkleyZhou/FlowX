import * as vscode from 'vscode';
import { loadHandoffSnapshot, saveCompletionDraft, saveHandoffSnapshot } from './completion-draft';
import { collectGitCompletionReport, getCurrentGitRoot, reportCompletion } from './completion-panel';
import { completeFlowXSignIn, configureFlowX, getFlowXConfig } from './config';
import { buildFlowXWebUrl } from './config-model';
import type { FlowXTaskItem } from './flowx-client';
import { FlowXClient } from './flowx-client';
import { getLocalGitReport, startInChat, writeTaskPromptFile } from './handoff';
import { FlowXTasksProvider } from './tasks-provider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new FlowXTasksProvider(vscode, context);
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        await completeFlowXSignIn(context, uri);
        provider.refresh();
      },
    }),
    vscode.window.registerTreeDataProvider('flowxTasks', provider),
    vscode.commands.registerCommand('flowx.configure', () => configureFlowX(context)),
    vscode.commands.registerCommand('flowx.refreshTasks', () => provider.refresh()),
    vscode.commands.registerCommand('flowx.openRequirements', async () => {
      const config = await getFlowXConfig(context);
      const apiBaseUrl = config?.apiBaseUrl ?? 'http://127.0.0.1:3000';
      await vscode.env.openExternal(vscode.Uri.parse(buildFlowXWebUrl(apiBaseUrl, '/requirements', process.env)));
    }),
    vscode.commands.registerCommand('flowx.startInChat', async (task: FlowXTaskItem) => {
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
    }),
    vscode.commands.registerCommand('flowx.reportCompletion', async (task: FlowXTaskItem) => {
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
          saveCompletionDraft,
          showError: (message) => vscode.window.showErrorMessage(message),
          showInfo: (message) => vscode.window.showInformationMessage(message),
          showInput: (prompt) => vscode.window.showInputBox({ ignoreFocusOut: true, prompt }),
          showQuickPick: (items, placeHolder) => vscode.window.showQuickPick(items, { ignoreFocusOut: true, placeHolder }),
          showWarning: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
        },
        task,
      );
    }),
  );
}

export function deactivate() {}
