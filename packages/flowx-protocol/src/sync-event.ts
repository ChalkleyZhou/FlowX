import { SOURCE_TOOLS, type SourceTool } from './execution-session.js';
import { isSupportedProtocolVersion } from './version.js';

export const SYNC_EVENT_TYPES = [
  'execution.claimed',
  'execution.started',
  'execution.progressed',
  'execution.heartbeat',
  'execution.blocked',
  'artifact.reported',
  'evidence.reported',
  'execution.completion_requested',
  'execution.completed',
  'execution.failed',
  'execution.cancelled',
] as const;

export type SyncEventType = (typeof SYNC_EVENT_TYPES)[number];

export interface FlowXSyncEvent<TPayload = unknown> {
  eventId: string;
  schemaVersion: string;
  executionSessionId: string;
  organizationId?: string;
  workspaceId?: string;
  projectId?: string;
  actorId?: string;
  deviceId?: string;
  sourceTool: SourceTool;
  traceId: string;
  entityType: string;
  entityId: string;
  eventType: SyncEventType;
  payload: TPayload;
  occurredAt: string;
  idempotencyKey: string;
  sequence?: number;
}

export interface SyncEventValidationResult {
  valid: boolean;
  errors: string[];
}

export function buildSyncEventIdempotencyKey(input: {
  executionSessionId: string;
  eventType: SyncEventType;
  eventId: string;
}): string {
  return `sync:${input.executionSessionId}:${input.eventType}:${input.eventId}`;
}

export function validateSyncEvent(event: FlowXSyncEvent): SyncEventValidationResult {
  const errors: string[] = [];
  const requiredStrings: Array<[string, string]> = [
    ['eventId', event.eventId],
    ['schemaVersion', event.schemaVersion],
    ['executionSessionId', event.executionSessionId],
    ['sourceTool', event.sourceTool],
    ['traceId', event.traceId],
    ['entityType', event.entityType],
    ['entityId', event.entityId],
    ['eventType', event.eventType],
    ['occurredAt', event.occurredAt],
    ['idempotencyKey', event.idempotencyKey],
  ];

  for (const [field, value] of requiredStrings) {
    if (!value.trim()) {
      errors.push(`${field} is required`);
    }
  }

  if (event.schemaVersion && !isSupportedProtocolVersion(event.schemaVersion)) {
    errors.push(`Unsupported schemaVersion: ${event.schemaVersion}`);
  }
  if (!SOURCE_TOOLS.includes(event.sourceTool)) {
    errors.push(`Unsupported sourceTool: ${event.sourceTool}`);
  }
  if (!SYNC_EVENT_TYPES.includes(event.eventType)) {
    errors.push(`Unsupported eventType: ${event.eventType}`);
  }
  if (Number.isNaN(Date.parse(event.occurredAt))) {
    errors.push('occurredAt must be an ISO date string');
  }
  if (event.sequence !== undefined && (!Number.isInteger(event.sequence) || event.sequence < 0)) {
    errors.push('sequence must be a non-negative integer');
  }

  return { valid: errors.length === 0, errors };
}
