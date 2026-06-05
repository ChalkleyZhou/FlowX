import type * as vscode from 'vscode';
import { getFlowXConfig } from './config';
import type { FlowXConfig } from './config-model';
import { FlowXClient } from './flowx-client';
import { getOriginRemoteUrl, getWorkspaceGitRoot, resolveWorkspacePath } from './repo-match';
import { buildTaskViewModels, type FlowXTaskViewModel } from './tasks-model';

type VscodeApi = typeof vscode;

export class FlowXTasksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter: vscode.EventEmitter<vscode.TreeItem | undefined>;
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined>;

  constructor(
    private readonly vscode: VscodeApi,
    private readonly context: vscode.ExtensionContext,
    private readonly createClient = (config: FlowXConfig) => new FlowXClient(config),
  ) {
    this.onDidChangeTreeDataEmitter = new this.vscode.EventEmitter<vscode.TreeItem | undefined>();
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  }

  refresh() {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem) {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const config = await getFlowXConfig(this.context);
    if (!config) {
      return [this.createPlaceholder('Sign in to FlowX to load tasks', 'flowx.configure')];
    }

    const workspacePath = resolveWorkspacePath(this.vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath));
    if (!workspacePath) {
      return [this.createPlaceholder('Open a local repository workspace')];
    }

    const gitRoot = await getWorkspaceGitRoot(workspacePath);
    const originRemoteUrl = gitRoot ? await getOriginRemoteUrl(gitRoot) : null;

    try {
      const tasks = await this.createClient(config).listTasks();
      if (tasks.length === 0) {
        return [
          this.createPlaceholder(
            'No FlowX tasks. Create a requirement or bug in FlowX.',
            'flowx.openRequirements',
            'Open FlowX Requirements',
          ),
        ];
      }
      return buildTaskViewModels(tasks, originRemoteUrl).map((model) => this.createTaskItem(model));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load FlowX tasks.';
      return [this.createPlaceholder(message)];
    }
  }

  private createTaskItem(model: FlowXTaskViewModel): vscode.TreeItem {
    const item = new this.vscode.TreeItem(model.label, this.vscode.TreeItemCollapsibleState.None);
    item.description = model.description;
    item.tooltip = model.tooltip;
    item.contextValue = model.contextValue;
    item.command = {
      command: 'flowx.showTaskActions',
      title: 'FlowX Task Actions',
      arguments: [model.task],
    };
    return item;
  }

  private createPlaceholder(label: string, command?: string, commandTitle = label): vscode.TreeItem {
    const item = new this.vscode.TreeItem(label, this.vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'flowxPlaceholder';
    if (command) {
      item.command = {
        command,
        title: commandTitle,
      };
    }
    return item;
  }
}
