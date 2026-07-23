import { ensureProject, writePromptFile } from './ensure-project.js';
import { openIde, type Ide } from './open-ide.js';
import { resolveRepoPath } from './repo-map.js';

type RedeemResponse = {
  apiBaseUrl: string;
  workflowRunId: string;
  handoff: {
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

export async function runLaunch(
  request: LaunchRequest,
  dependencies: LaunchDependencies = {},
): Promise<{
  ok: true;
  gitRoot: string;
  ide: Ide;
  prefilled: boolean;
  promptPath: string;
}> {
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
  if (!repository) {
    throw new Error('No repository URL was provided by the local handoff.');
  }
  if (!redeemed.workflowRunId || !redeemed.chatPrompt || !redeemed.mcpToken || !redeemed.apiBaseUrl) {
    throw redeemError('Redeem response is incomplete.');
  }

  const gitRoot = await (dependencies.resolveRepoPath ?? resolveRepoPath)(repository.url);
  (dependencies.ensureProject ?? ensureProject)(gitRoot, {
    apiBaseUrl: redeemed.apiBaseUrl,
    mcpToken: redeemed.mcpToken,
  });
  const promptPath = (dependencies.writePromptFile ?? writePromptFile)(
    gitRoot,
    redeemed.workflowRunId,
    redeemed.chatPrompt,
  );
  const opened = await (dependencies.openIde ?? openIde)(
    request.ide,
    gitRoot,
    redeemed.chatPrompt,
  );

  return {
    ok: true,
    gitRoot,
    ide: request.ide,
    prefilled: opened.prefilled,
    promptPath,
  };
}
