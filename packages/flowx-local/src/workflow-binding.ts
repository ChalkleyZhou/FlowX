import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type WorkflowBindingStage = 'brainstorm' | 'design';

export type WorkflowBinding = {
  workflowRunId: string;
  stage: WorkflowBindingStage;
  boundAt: string;
  requirementTitle?: string;
};

export function getWorkflowBindingPath(homeDir = homedir()): string {
  return join(homeDir, '.flowx', 'current-workflow.json');
}

function asWorkflowBinding(parsed: Partial<WorkflowBinding>): WorkflowBinding | null {
  const workflowRunId = typeof parsed.workflowRunId === 'string' ? parsed.workflowRunId.trim() : '';
  const stage = parsed.stage === 'brainstorm' || parsed.stage === 'design' ? parsed.stage : null;
  if (!workflowRunId || !stage) {
    return null;
  }
  const binding: WorkflowBinding = {
    workflowRunId,
    stage,
    boundAt: typeof parsed.boundAt === 'string' ? parsed.boundAt : '',
  };
  if (typeof parsed.requirementTitle === 'string' && parsed.requirementTitle.trim()) {
    binding.requirementTitle = parsed.requirementTitle.trim();
  }
  return binding;
}

export async function readWorkflowBinding(homeDir = homedir()): Promise<WorkflowBinding | null> {
  try {
    const parsed = JSON.parse(await readFile(getWorkflowBindingPath(homeDir), 'utf8')) as Partial<WorkflowBinding>;
    return asWorkflowBinding(parsed);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    return null;
  }
}

export async function writeWorkflowBinding(
  input: {
    workflowRunId: string;
    stage: WorkflowBindingStage;
    boundAt?: string;
    requirementTitle?: string;
  },
  homeDir = homedir(),
): Promise<WorkflowBinding> {
  const workflowRunId = input.workflowRunId.trim();
  if (!workflowRunId) {
    throw new Error('workflowRunId is required.');
  }
  if (input.stage !== 'brainstorm' && input.stage !== 'design') {
    throw new Error('stage must be brainstorm or design.');
  }
  const path = getWorkflowBindingPath(homeDir);
  await mkdir(dirname(path), { recursive: true });
  const body: WorkflowBinding = {
    workflowRunId,
    stage: input.stage,
    boundAt: input.boundAt ?? new Date().toISOString(),
  };
  const title = input.requirementTitle?.trim();
  if (title) {
    body.requirementTitle = title;
  }
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return body;
}

export async function clearWorkflowBinding(homeDir = homedir()): Promise<boolean> {
  try {
    await rm(getWorkflowBindingPath(homeDir), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** 解析 workflowRunId：工具参数 → binding → active-design → 明确错误。 */
export function missingWorkflowBindingError(): string {
  return 'workflowRunId is required. Call flowx_list_tasks, confirm a run with the user, then flowx_bind_workflow.';
}

/** 解析 executionSessionId 失败时的提示（binding 不含 session id）。 */
export function missingExecutionSessionError(): string {
  return 'executionSessionId is required. Call flowx_list_tasks, flowx_bind_workflow, then get_*_handoff (or pass executionSessionId explicitly).';
}
