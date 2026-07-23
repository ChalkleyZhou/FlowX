import { ensureProject, writePromptFile } from '../ensure-project.js';
import { openIde, type Ide } from '../open-ide.js';

export type IdeLaunchInput = {
  ide: Ide;
  gitRoot: string;
  workflowRunId: string;
  executionSessionId: string;
  chatPrompt: string;
  apiBaseUrl: string;
  mcpToken: string;
  mcpEntryPath: string;
};

export type IdeLaunchResult = {
  ok: true;
  gitRoot: string;
  ide: Ide;
  prefilled: boolean;
  promptPath: string;
  executionSessionId: string;
  workflowRunId: string;
};

export type IdeAdapterLaunchInput = Omit<IdeLaunchInput, 'ide'>;

export type IdeAdapterDeps = {
  ensureProject?: typeof ensureProject;
  writePromptFile?: typeof writePromptFile;
  openIde?: typeof openIde;
};

export async function launchIde(
  input: IdeLaunchInput,
  deps: IdeAdapterDeps = {},
): Promise<IdeLaunchResult> {
  if (!input.workflowRunId?.trim()) {
    throw new Error('workflowRunId is required');
  }
  if (!input.executionSessionId?.trim()) {
    throw new Error('executionSessionId is required');
  }

  (deps.ensureProject ?? ensureProject)(input.gitRoot, {
    apiBaseUrl: input.apiBaseUrl,
    mcpToken: input.mcpToken,
    mcpEntryPath: input.mcpEntryPath,
  });
  const promptPath = (deps.writePromptFile ?? writePromptFile)(
    input.gitRoot,
    input.workflowRunId,
    input.chatPrompt,
  );
  const opened = await (deps.openIde ?? openIde)(input.ide, input.gitRoot, input.chatPrompt);

  return {
    ok: true,
    gitRoot: input.gitRoot,
    ide: input.ide,
    prefilled: opened.prefilled,
    promptPath,
    executionSessionId: input.executionSessionId,
    workflowRunId: input.workflowRunId,
  };
}
