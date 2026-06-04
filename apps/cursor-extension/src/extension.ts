import * as vscode from 'vscode';
import { configureFlowX } from './config';

class FlowXPlaceholderProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh() {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem) {
    return element;
  }

  getChildren() {
    const item = new vscode.TreeItem('Configure FlowX to load tasks', vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'flowxPlaceholder';
    return [item];
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new FlowXPlaceholderProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('flowxTasks', provider),
    vscode.commands.registerCommand('flowx.configure', () => configureFlowX(context)),
    vscode.commands.registerCommand('flowx.refreshTasks', () => provider.refresh()),
  );
}

export function deactivate() {}
