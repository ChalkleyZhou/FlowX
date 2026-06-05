import * as vscode from 'vscode';
import {
  buildFlowXLoginUrl,
  buildCursorAuthCallbackUri,
  normalizeApiBaseUrl,
  parseFlowXAuthCallback,
  type FlowXConfig,
  type FlowXAuthOrganization,
} from './config-model';

const API_BASE_URL_KEY = 'flowx.apiBaseUrl';
const API_TOKEN_SECRET_KEY = 'flowx.apiToken';

export async function getFlowXConfig(context: vscode.ExtensionContext): Promise<FlowXConfig | null> {
  const apiBaseUrl = context.workspaceState.get<string>(API_BASE_URL_KEY) ?? '';
  const apiToken = await context.secrets.get(API_TOKEN_SECRET_KEY);

  if (!apiBaseUrl || !apiToken) {
    return null;
  }

  return { apiBaseUrl, apiToken };
}

export async function signInToFlowX(context: vscode.ExtensionContext) {
  const currentApiBaseUrl = context.workspaceState.get<string>(API_BASE_URL_KEY) ?? 'http://127.0.0.1:3000';

  const inputApiBaseUrl = await vscode.window.showInputBox({
    title: 'FlowX URL',
    value: currentApiBaseUrl,
    ignoreFocusOut: true,
    prompt: 'Example: http://127.0.0.1:5173 or http://127.0.0.1:3000',
  });
  if (!inputApiBaseUrl) {
    return;
  }

  const apiBaseUrl = normalizeApiBaseUrl(inputApiBaseUrl);
  await context.workspaceState.update(API_BASE_URL_KEY, apiBaseUrl);

  const callbackUri = await vscode.env.asExternalUri(
    vscode.Uri.parse(buildCursorAuthCallbackUri(vscode.env.uriScheme, context.extension.id)),
  );
  await vscode.env.openExternal(
    vscode.Uri.parse(
      buildFlowXLoginUrl({
        apiBaseUrl,
        callbackUrl: callbackUri.toString(),
      }),
    ),
  );
  vscode.window.showInformationMessage('FlowX login opened. Complete DingTalk login in the browser.');
}

export async function completeFlowXSignIn(context: vscode.ExtensionContext, uri: vscode.Uri) {
  const result = parseFlowXAuthCallback(uri.query);
  if (result.type === 'error') {
    vscode.window.showErrorMessage(result.message);
    return;
  }

  const token =
    result.type === 'token'
      ? result.token
      : await selectOrganizationAndExchangeToken(context, result.selectionToken, result.organizations);
  if (!token) {
    return;
  }
  await context.secrets.store(API_TOKEN_SECRET_KEY, token);
  vscode.window.showInformationMessage('FlowX sign-in complete.');
}

async function selectOrganizationAndExchangeToken(
  context: vscode.ExtensionContext,
  selectionToken: string,
  organizations: FlowXAuthOrganization[],
) {
  const selected = await vscode.window.showQuickPick(
    organizations.map((organization) => ({
      label: organization.name,
      description: organization.id,
      organization,
    })),
    {
      ignoreFocusOut: true,
      placeHolder: 'Select FlowX organization',
    },
  );
  if (!selected) {
    return null;
  }

  const apiBaseUrl = context.workspaceState.get<string>(API_BASE_URL_KEY) ?? 'http://127.0.0.1:3000';
  const response = await fetch(`${apiBaseUrl}/auth/organization/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectionToken,
      organizationId: selected.organization.id,
    }),
  });

  if (!response.ok) {
    vscode.window.showErrorMessage((await response.text()) || 'FlowX organization selection failed.');
    return null;
  }

  const session = (await response.json()) as { token?: string };
  if (!session.token) {
    vscode.window.showErrorMessage('FlowX organization selection did not return a token.');
    return null;
  }

  return session.token;
}

export async function configureFlowX(context: vscode.ExtensionContext) {
  return signInToFlowX(context);
}
