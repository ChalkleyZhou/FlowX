import { describe, expect, it } from 'vitest';
import {
  FLOWX_PROTOCOL_VERSION,
  buildSyncEventIdempotencyKey,
  canTransitionExecutionSession,
  isExecutionSessionTerminal,
  isSupportedProtocolVersion,
  validateSyncEvent,
  type FlowXSyncEvent,
} from './index.js';

function createEvent(overrides: Partial<FlowXSyncEvent> = {}): FlowXSyncEvent {
  return {
    eventId: 'event-1',
    schemaVersion: FLOWX_PROTOCOL_VERSION,
    executionSessionId: 'session-1',
    sourceTool: 'cursor',
    traceId: 'trace-1',
    entityType: 'execution-session',
    entityId: 'session-1',
    eventType: 'execution.started',
    payload: {},
    occurredAt: '2026-07-22T00:00:00.000Z',
    idempotencyKey: 'sync:session-1:execution.started:event-1',
    ...overrides,
  };
}

describe('flowx protocol', () => {
  it('accepts the current protocol version and rejects unknown versions', () => {
    expect(isSupportedProtocolVersion(FLOWX_PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedProtocolVersion('2.0')).toBe(false);
  });

  it('enforces execution session terminal states', () => {
    expect(canTransitionExecutionSession('CREATED', 'CLAIMED')).toBe(true);
    expect(canTransitionExecutionSession('RUNNING', 'COMPLETED')).toBe(true);
    expect(canTransitionExecutionSession('COMPLETED', 'RUNNING')).toBe(false);
    expect(isExecutionSessionTerminal('FAILED')).toBe(true);
    expect(isExecutionSessionTerminal('RUNNING')).toBe(false);
  });

  it('builds a stable sync event idempotency key', () => {
    expect(
      buildSyncEventIdempotencyKey({
        executionSessionId: 'session-1',
        eventType: 'execution.completed',
        eventId: 'event-9',
      }),
    ).toBe('sync:session-1:execution.completed:event-9');
  });

  it('validates required event fields and protocol compatibility', () => {
    expect(validateSyncEvent(createEvent())).toEqual({ valid: true, errors: [] });

    const result = validateSyncEvent(
      createEvent({
        eventId: '',
        schemaVersion: '2.0',
        sourceTool: 'unknown' as FlowXSyncEvent['sourceTool'],
        occurredAt: 'not-a-date',
        sequence: -1,
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'eventId is required',
        'Unsupported schemaVersion: 2.0',
        'Unsupported sourceTool: unknown',
        'occurredAt must be an ISO date string',
        'sequence must be a non-negative integer',
      ]),
    );
  });
});
