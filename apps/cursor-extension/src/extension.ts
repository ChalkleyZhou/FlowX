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
  openPromptInChat,
  readTaskPromptFile,
  startInChat,
  writeTaskPromptFile,
} from './handoff';
import { claimAndHandoffLocalExecution } from './local-execution';
import {
  buildLocalDesignPrompt,
  generateLocalDesign,
  readLocalDesignFile,
  submitLocalDesignFromFile,
} from './local-design';
import { dispatchStageAction } from './run-detail-actions';
import { openRunDetailPanel } from './run-detail-panel';
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
  const openRunDetailForTask = async (task: FlowXTaskItem) => {
    if (!task.workflowRunId) {
      vscode.window.showErrorMessage('该任务还没有关联的工作流 run。');
      return;
    }
    const config = await getFlowXConfig(context);
    if (!config) {
      vscode.window.showErrorMessage('Configure FlowX before opening a workflow run.');
      return;
    }
    const client = new FlowXClient(config);
    const workspacePaths = () => vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath);

    const claimDeps = {
      claimLocal: (runId: string) => client.claimLocal(runId),
      getLocalHandoff: (runId: string) => client.getLocalHandoff(runId),
      getGitRoot: () => getCurrentGitRoot(workspacePaths()),
      buildPrompt: buildPromptFromLocalHandoff,
      writeTaskFile: writeTaskPromptFile,
      saveHandoff: (gitRoot: string, currentTask: FlowXTaskItem, handoff: Awaited<ReturnType<typeof client.getLocalHandoff>>) =>
        saveRestoredHandoffSnapshot(gitRoot, currentTask, handoff),
      copyToClipboard: (content: string) => Promise.resolve(vscode.env.clipboard.writeText(content)).then(() => undefined),
      openPromptInChat: (prompt: string) =>
        openPromptInChat({ executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args) }, prompt),
      showError: (message: string) => vscode.window.showErrorMessage(message),
      showInfo: (message: string) => vscode.window.showInformationMessage(message),
    };

    const openInChat = (prompt: string) =>
      openPromptInChat({ executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args) }, prompt);

    const execDeps = {
      claimLocalExecution: () => claimAndHandoffLocalExecution(claimDeps, task),
      cancelLocalExecution: (runId: string) => client.cancelLocal(runId).then(() => undefined),
      completeLocalExecution: () => reportTaskCompletion(task),
      generateLocalDesign: () =>
        generateLocalDesign(
          {
            getGitRoot: () => getCurrentGitRoot(workspacePaths()),
            buildPrompt: buildLocalDesignPrompt,
            copyToClipboard: (content: string) =>
              Promise.resolve(vscode.env.clipboard.writeText(content)).then(() => undefined),
            openPromptInChat: openInChat,
            showError: (message: string) => vscode.window.showErrorMessage(message),
            showInfo: (message: string) => vscode.window.showInformationMessage(message),
          },
          task,
        ),
      submitLocalDesign: (runId: string) =>
        submitLocalDesignFromFile(
          {
            getGitRoot: () => getCurrentGitRoot(workspacePaths()),
            readDesignFile: (gitRoot: string, rid: string) => readLocalDesignFile(gitRoot, rid),
            submit: (rid: string, body) => client.submitLocalDesign(rid, body).then(() => undefined),
            showError: (message: string) => vscode.window.showErrorMessage(message),
            showInfo: (message: string) => vscode.window.showInformationMessage(message),
          },
          runId,
        ),
    };

    openRunDetailPanel(
      vscode,
      {
        getRun: (runId) => client.getRun(runId),
        dispatch: (request) => dispatchStageAction(client, execDeps, request),
        promptFeedback: (label) => Promise.resolve(vscode.window.showInputBox({ ignoreFocusOut: true, prompt: label })),
        showError: (message) => vscode.window.showErrorMessage(message),
        showInfo: (message) => vscode.window.showInformationMessage(message),
        onChanged: () => provider.refresh(),
      },
      task.workflowRunId,
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
            const openedInChat = await openPromptInChat(
              {
                executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
              },
              prompt,
            );
            vscode.window.showInformationMessage(
              openedInChat ? 'FlowX prompt opened in chat.' : 'FlowX prompt copied.',
            );
          },
          openChat: async () => {
            await vscode.commands.executeCommand('workbench.action.chat.open');
          },
          openFlowX: async () => {
            const config = await getFlowXConfig(context);
            const apiBaseUrl = config?.apiBaseUrl ?? 'http://127.0.0.1:3000';
            await vscode.env.openExternal(vscode.Uri.parse(buildFlowXWebUrl(apiBaseUrl, '/requirements', process.env)));
          },
          openRunDetail: openRunDetailForTask,
          refreshTasks: () => provider.refresh(),
          reportCompletion: reportTaskCompletion,
          showQuickPick: (items, placeHolder) => vscode.window.showQuickPick(items, { ignoreFocusOut: true, placeHolder }),
          startInChat: startTaskInChat,
        },
        task,
      ),
    ),
    vscode.commands.registerCommand('flowx.startInChat', startTaskInChat),
    vscode.commands.registerCommand('flowx.reportCompletion', reportTaskCompletion),
    vscode.commands.registerCommand('flowx.openRunDetail', openRunDetailForTask),
  );
}

export function deactivate() {}
