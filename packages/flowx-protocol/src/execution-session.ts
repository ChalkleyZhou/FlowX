export const EXECUTION_SESSION_STATUSES = [
  'CREATED',
  'CLAIMED',
  'RUNNING',
  'COMPLETING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type ExecutionSessionStatus = (typeof EXECUTION_SESSION_STATUSES)[number];

export const EXECUTION_SESSION_TERMINAL_STATUSES = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly ExecutionSessionStatus[];

export const EXECUTOR_TYPES = ['LOCAL', 'CLOUD', 'CI'] as const;

export type ExecutorType = (typeof EXECUTOR_TYPES)[number];

export const SOURCE_TOOLS = [
  'cursor',
  'codex',
  'opendesign',
  'shell',
  'test-runner',
  'flowx-worker',
] as const;

export type SourceTool = (typeof SOURCE_TOOLS)[number];

const EXECUTION_SESSION_TRANSITIONS: Record<
  ExecutionSessionStatus,
  readonly ExecutionSessionStatus[]
> = {
  CREATED: ['CLAIMED', 'RUNNING', 'FAILED', 'CANCELLED'],
  CLAIMED: ['RUNNING', 'FAILED', 'CANCELLED'],
  RUNNING: ['COMPLETING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isExecutionSessionTerminal(status: ExecutionSessionStatus): boolean {
  return EXECUTION_SESSION_TERMINAL_STATUSES.includes(
    status as (typeof EXECUTION_SESSION_TERMINAL_STATUSES)[number],
  );
}

export function canTransitionExecutionSession(
  from: ExecutionSessionStatus,
  to: ExecutionSessionStatus,
): boolean {
  return EXECUTION_SESSION_TRANSITIONS[from].includes(to);
}

export interface ExecutionSessionRef {
  id: string;
  workflowRunId: string;
  stageExecutionId?: string | null;
  status: ExecutionSessionStatus;
  executorType: ExecutorType;
  sourceTool: SourceTool;
  protocolVersion: string;
  traceId: string;
}

export interface CompletionRepositoryReport {
  workflowRepositoryId: string;
  headSha: string;
  changedFiles: string[];
  patchSummary?: string;
}

/**
 * @deprecated Legacy internal shape used by `WorkflowService`'s local-completion bookkeeping
 * (persisted execution session metadata / artifacts). New code should prefer
 * `LocalCompletionReport` (see `local-completion.ts`) as the single source of truth for the
 * wire-level local completion contract; this type is kept only to avoid churn in existing
 * persisted metadata and call sites.
 */
export interface CompletionReport {
  idempotencyKey: string;
  pushed: boolean;
  implementationSummary?: string;
  testResult?: string;
  diffSummary?: string;
  untrackedFiles?: string[];
  repositories: CompletionRepositoryReport[];
}
