import * as vscode from 'vscode';
import { configureFlowX, getFlowXConfig } from './config';
import type { FlowXTaskItem } from './flowx-client';
import { FlowXClient } from './flowx-client';
import { getLocalGitReport, startInChat, writeTaskPromptFile } from './handoff';
import { FlowXTasksProvider } from './tasks-provider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new FlowXTasksProvider(vscode, context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('flowxTasks', provider),
    vscode.commands.registerCommand('flowx.configure', () => configureFlowX(context)),
    vscode.commands.registerCommand('flowx.refreshTasks', () => provider.refresh()),
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
          writeTaskFile: writeTaskPromptFile,
        },
        task,
      );
    }),
  );
}

export function deactivate() {}
