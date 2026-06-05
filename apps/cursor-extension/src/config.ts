import * as vscode from 'vscode';

const API_BASE_URL_KEY = 'flowx.apiBaseUrl';
const WORKSPACE_ID_KEY = 'flowx.workspaceId';
const API_TOKEN_SECRET_KEY = 'flowx.apiToken';

export interface FlowXConfig {
  apiBaseUrl: string;
  workspaceId: string;
  apiToken: string;
}

export async function getFlowXConfig(context: vscode.ExtensionContext): Promise<FlowXConfig | null> {
  const apiBaseUrl = context.workspaceState.get<string>(API_BASE_URL_KEY) ?? '';
  const workspaceId = context.workspaceState.get<string>(WORKSPACE_ID_KEY) ?? '';
  const apiToken = await context.secrets.get(API_TOKEN_SECRET_KEY);

  if (!apiBaseUrl || !workspaceId || !apiToken) {
    return null;
  }

  return { apiBaseUrl, workspaceId, apiToken };
}

export async function configureFlowX(context: vscode.ExtensionContext) {
  const currentApiBaseUrl = context.workspaceState.get<string>(API_BASE_URL_KEY) ?? 'http://127.0.0.1:3000';
  const currentWorkspaceId = context.workspaceState.get<string>(WORKSPACE_ID_KEY) ?? '';

  const apiBaseUrl = await vscode.window.showInputBox({
    title: 'FlowX API Base URL',
    value: currentApiBaseUrl,
    ignoreFocusOut: true,
    prompt: 'Example: http://127.0.0.1:3000',
  });
  if (!apiBaseUrl) {
    return;
  }

  const workspaceId = await vscode.window.showInputBox({
    title: 'FlowX Workspace ID',
    value: currentWorkspaceId,
    ignoreFocusOut: true,
  });
  if (!workspaceId) {
    return;
  }

  const apiToken = await vscode.window.showInputBox({
    title: 'FlowX API Token',
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiToken) {
    return;
  }

  await context.workspaceState.update(API_BASE_URL_KEY, apiBaseUrl.replace(/\/$/, ''));
  await context.workspaceState.update(WORKSPACE_ID_KEY, workspaceId);
  await context.secrets.store(API_TOKEN_SECRET_KEY, apiToken);
  vscode.window.showInformationMessage('FlowX configuration saved.');
}
