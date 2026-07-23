// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionSessionPanel } from './ExecutionSessionPanel';

describe('ExecutionSessionPanel', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
  });

  it('returns no content when there is no execution session', async () => {
    await act(async () => {
      root?.render(<ExecutionSessionPanel session={null} evidence={[]} />);
    });

    expect(container.innerHTML).toBe('');
  });

  it('shows execution details, evidence, recent events, and refreshes on demand', async () => {
    const onRefresh = vi.fn();

    await act(async () => {
      root?.render(
        <ExecutionSessionPanel
          session={{
            id: 'session-1',
            workflowRunId: 'workflow-1',
            status: 'RUNNING',
            executorType: 'LOCAL',
            sourceTool: 'cursor',
            protocolVersion: '1.0',
            traceId: 'trace-123',
            deviceId: 'device-1',
            lastHeartbeatAt: '2026-07-23T08:00:00.000Z',
            createdAt: '2026-07-23T07:00:00.000Z',
            updatedAt: '2026-07-23T08:00:00.000Z',
          }}
          evidence={[
            {
              id: 'evidence-1',
              executionSessionId: 'session-1',
              evidenceType: 'TEST_RESULT',
              sourceTool: 'test-runner',
              title: 'Web tests passed',
              summary: '42 tests passed',
              status: 'VERIFIED',
              occurredAt: '2026-07-23T08:01:00.000Z',
              createdAt: '2026-07-23T08:01:00.000Z',
              updatedAt: '2026-07-23T08:01:00.000Z',
            },
          ]}
          events={[
            {
              id: 'event-1',
              eventId: 'sync-1',
              executionSessionId: 'session-1',
              schemaVersion: '1.0',
              eventType: 'HEARTBEAT',
              sourceTool: 'cursor',
              traceId: 'trace-123',
              occurredAt: '2026-07-23T08:00:00.000Z',
              receivedAt: '2026-07-23T08:00:01.000Z',
              idempotencyKey: 'event-key-1',
              payload: {},
            },
          ]}
          onRefresh={onRefresh}
        />,
      );
    });

    expect(container.textContent).toContain('执行会话');
    expect(container.textContent).toContain('RUNNING');
    expect(container.textContent).toContain('cursor');
    expect(container.textContent).toContain('device-1');
    expect(container.textContent).toContain('trace-123');
    expect(container.textContent).toContain('Web tests passed');
    expect(container.textContent).toContain('HEARTBEAT');

    const refreshButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('刷新'),
    );
    await act(async () => {
      refreshButton?.click();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
