import * as vscode from 'vscode';
import { configureFlowX } from './config';
import type { FlowXTaskItem } from './flowx-client';
import { FlowXTasksProvider } from './tasks-provider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new FlowXTasksProvider(vscode, context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('flowxTasks', provider),
    vscode.commands.registerCommand('flowx.configure', () => configureFlowX(context)),
    vscode.commands.registerCommand('flowx.refreshTasks', () => provider.refresh()),
    vscode.commands.registerCommand('flowx.startInChat', (task: FlowXTaskItem) => {
      vscode.window.showInformationMessage(`FlowX task selected: ${task.title}`);
    }),
  );
}

export function deactivate() {}
