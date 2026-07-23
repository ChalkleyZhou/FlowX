import { describe, expect, it } from 'vitest';
import {
  FLOWX_PROTOCOL_VERSION,
  buildSyncEventIdempotencyKey,
  canTransitionExecutionSession,
  isExecutionSessionTerminal,
  isSupportedProtocolVersion,
  validateSyncEvent,
  type DesignCompletionReport,
  type OpenDesignContextPackage,
  type FlowXSyncEvent,
} from './index.js';
import {
  assertLocalCompletionReport,
  buildLocalCompletionIdempotencyKey,
} from './local-completion.js';

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

  it('shares a versioned OpenDesign context and completion contract', () => {
    const context: OpenDesignContextPackage = {
      protocolVersion: FLOWX_PROTOCOL_VERSION,
      generatedAt: '2026-07-22T00:00:00.000Z',
      sourceTool: 'opendesign',
      workflowRunId: 'workflow-1',
      executionSessionId: 'session-1',
      traceId: 'trace-1',
      requirement: {
        id: 'req-1',
        title: 'Design export page',
        description: 'Create an export experience.',
        acceptanceCriteria: 'The design covers loading and error states.',
      },
      repositories: [],
      outputContract: {
        resultFileName: 'result.json',
        format: 'flowx-design-result-v1',
        requiredFields: ['design', 'demo', 'designArtifact'],
      },
    };
    const report: DesignCompletionReport = {
      idempotencyKey: 'design:session-1:v1',
      output: {
        design: { overview: 'Export page' },
        demo: { summary: 'Primary flow' },
        designArtifact: { html: '<!doctype html><html></html>' },
      },
    };

    expect(context.sourceTool).toBe('opendesign');
    expect(report.output.designArtifact.html).toContain('<!doctype html>');
  });

  it('accepts a valid LocalCompletionReport', () => {
    const report = {
      idempotencyKey: 'local:session-1:v1',
      pushed: true,
      implementationSummary: 'Done',
      testResult: 'pass',
      repositories: [
        {
          workflowRepositoryId: 'wr-1',
          headSha: 'a'.repeat(40),
          changedFiles: ['src/a.ts'],
        },
      ],
    };
    expect(assertLocalCompletionReport(report)).toEqual(report);
  });

  it('rejects empty changedFiles', () => {
    expect(() =>
      assertLocalCompletionReport({
        idempotencyKey: 'k',
        pushed: false,
        repositories: [{ workflowRepositoryId: 'wr-1', headSha: 'abc', changedFiles: [] }],
      }),
    ).toThrow(/changedFiles/);
  });

  it('builds a stable idempotency key', () => {
    expect(
      buildLocalCompletionIdempotencyKey({
        executionSessionId: 'session-1',
        headShas: ['abc'],
      }),
    ).toBe('local:session-1:abc');
  });
});
