import { ensureProject, writePromptFile } from './ensure-project.js';
import { CodexAdapter } from './adapters/codex-adapter.js';
import { CursorAdapter } from './adapters/cursor-adapter.js';
import { AdapterRegistry } from './adapters/adapter-registry.js';
import type { IdeAdapterDeps, IdeAdapterLaunchInput, IdeLaunchResult } from './adapters/ide-launch.js';
import type { ToolAdapter } from './adapters/tool-adapter.js';
import { openIde, type Ide } from './open-ide.js';
import { resolveRepoPath } from './repo-map.js';

type RedeemResponse = {
  apiBaseUrl: string;
  workflowRunId: string;
  handoff: {
    executionSessionId?: string;
    repositories: Array<{ url: string; workingBranch?: string }>;
  };
  chatPrompt: string;
  mcpToken: string;
};

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

export type LaunchRequest = {
  ticket: string;
  ide: Ide;
  apiBaseUrl: string;
};

export type LaunchDependencies = {
  fetch?: (url: string, init: RequestInit) => Promise<FetchResponse>;
  resolveRepoPath?: (repoUrl: string) => Promise<string>;
  ensureProject?: typeof ensureProject;
  writePromptFile?: typeof writePromptFile;
  openIde?: typeof openIde;
  /** Optional absolute MCP entry; when omitted, ensureProject defaults to `flowx-local mcp`. */
  mcpEntryPath?: string;
  registry?: {
    resolve(name: Ide): ToolAdapter<IdeAdapterLaunchInput, IdeLaunchResult>;
  };
};

export type RedeemFailedError = Error & { code: 'REDEEM_FAILED' };

function redeemError(message: string): RedeemFailedError {
  const error = new Error(message) as RedeemFailedError;
  error.code = 'REDEEM_FAILED';
  return error;
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.trim().replace(/\/+$/, '');
}

export function defaultIdeRegistry(deps: IdeAdapterDeps = {}) {
  return new AdapterRegistry([new CursorAdapter(deps), new CodexAdapter(deps)]);
}

export async function runLaunch(
  request: LaunchRequest,
  dependencies: LaunchDependencies = {},
): Promise<IdeLaunchResult> {
  if (!request.ticket?.trim() || !request.apiBaseUrl?.trim()) {
    throw new Error('ticket and apiBaseUrl are required');
  }

  const apiBaseUrl = normalizeApiBaseUrl(request.apiBaseUrl);
  const send = dependencies.fetch ?? fetch;
  let response: FetchResponse;
  try {
    response = await send(`${apiBaseUrl}/local-launch/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: request.ticket }),
    });
  } catch {
    throw redeemError('Failed to redeem local launch ticket.');
  }
  if (!response.ok || !response.json) {
    throw redeemError(`Failed to redeem local launch ticket (${response.status ?? 'unknown'}).`);
  }

  const redeemed = (await response.json()) as RedeemResponse;
  const repository = redeemed.handoff?.repositories.find((item) => item.url?.trim());
  const executionSessionId = redeemed.handoff?.executionSessionId?.trim();
  if (!repository) {
    throw new Error('No repository URL was provided by the local handoff.');
  }
  if (!redeemed.workflowRunId || !redeemed.chatPrompt || !redeemed.mcpToken || !redeemed.apiBaseUrl) {
    throw redeemError('Redeem response is incomplete.');
  }
  if (!executionSessionId) {
    throw redeemError('Redeem response is missing an execution session id.');
  }

  const gitRoot = await (dependencies.resolveRepoPath ?? resolveRepoPath)(repository.url);
  const registry =
    dependencies.registry ??
    defaultIdeRegistry({
      ensureProject: dependencies.ensureProject,
      writePromptFile: dependencies.writePromptFile,
      openIde: dependencies.openIde,
    });

  return registry.resolve(request.ide).launch({
    gitRoot,
    workflowRunId: redeemed.workflowRunId,
    executionSessionId,
    chatPrompt: redeemed.chatPrompt,
    apiBaseUrl: apiBaseUrl,
    mcpToken: redeemed.mcpToken,
    mcpEntryPath: dependencies.mcpEntryPath,
  });
}
