import { isExecutionSessionTerminal, type ExecutionSessionStatus } from './execution-session.js';

export const EXECUTION_COMMAND_TYPES = ['CANCEL', 'RESUME', 'REQUEST_SYNC'] as const;
export type ExecutionCommandType = (typeof EXECUTION_COMMAND_TYPES)[number];
export const EXECUTION_COMMAND_OUTCOMES = ['ACKED', 'FAILED'] as const;
export type ExecutionCommandOutcome = (typeof EXECUTION_COMMAND_OUTCOMES)[number];
export type ExecutionCommandStatus = 'CREATED' | 'DELIVERED' | ExecutionCommandOutcome | 'EXPIRED';
export const EXECUTION_HEARTBEAT_INTERVAL_MS = 30_000;
export const EXECUTION_STALE_AFTER_MS = 300_000;
export type ExecutionHealth = 'UNKNOWN' | 'ONLINE' | 'STALE' | 'TERMINAL';

export interface ExecutionCommandRef {
  id: string;
  executionSessionId: string;
  commandType: ExecutionCommandType;
  status: ExecutionCommandStatus;
  issuedAt: string;
  deliveredAt?: string | null;
  acknowledgedAt?: string | null;
  expiresAt?: string | null;
  errorMessage?: string | null;
}

export interface ExecutionCheckpointResult {
  session: { id: string; workflowRunId?: string | null; status: string; cancelRequestedAt?: string | null; blockedReason?: string | null };
  commands: ExecutionCommandRef[];
  heartbeatIntervalMs: number;
}

/** 健康状态只表达服务端最近收到检查点的时间，不证明 IDE 内的进程仍在执行。 */
export function getExecutionHealth(session: {
  status: string;
  controlMode?: string | null;
  lastHeartbeatAt?: Date | string | null;
}, now = new Date()): ExecutionHealth {
  if (isExecutionSessionTerminal(session.status as ExecutionSessionStatus)) return 'TERMINAL';
  if (session.controlMode !== 'COOPERATIVE' || !session.lastHeartbeatAt) return 'UNKNOWN';
  const heartbeat = new Date(session.lastHeartbeatAt).getTime();
  if (!Number.isFinite(heartbeat)) return 'UNKNOWN';
  return now.getTime() - heartbeat >= EXECUTION_STALE_AFTER_MS ? 'STALE' : 'ONLINE';
}
