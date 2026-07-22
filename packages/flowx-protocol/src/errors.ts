export const FLOWX_PROTOCOL_ERROR_CODES = [
  'EDGE_TASK_NOT_ELIGIBLE',
  'EDGE_REPOSITORY_MISMATCH',
  'EXECUTION_SESSION_CONFLICT',
  'EXECUTION_SESSION_TERMINAL',
  'SYNC_EVENT_DUPLICATE',
  'SYNC_EVENT_OUT_OF_ORDER',
  'ARTIFACT_INVALID_REFERENCE',
  'REMOTE_BRANCH_NOT_VERIFIED',
  'PROTOCOL_VERSION_UNSUPPORTED',
] as const;

export type FlowXProtocolErrorCode = (typeof FLOWX_PROTOCOL_ERROR_CODES)[number];

export interface FlowXProtocolErrorPayload {
  code: FlowXProtocolErrorCode;
  message: string;
  traceId?: string;
  details?: Record<string, unknown>;
}
