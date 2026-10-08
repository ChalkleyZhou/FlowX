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
  it('显示失联和待取消回执，禁用重复取消', async () => {
    const onCommand = vi.fn();
    await act(async () => root?.render(<ExecutionSessionPanel evidence={[]} onCommand={onCommand} session={{
      id: 's1', workflowRunId: 'w1', status: 'RUNNING', executorType: 'LOCAL', sourceTool: 'codex',
      protocolVersion: '1.2', traceId: 't1', createdAt: '', updatedAt: '', health: 'STALE',
      controlMode: 'COOPERATIVE', canControl: true, cancelRequestedAt: '2026-09-30T08:00:00Z',
      commands: [{ id: 'c1', commandType: 'CANCEL', status: 'DELIVERED', issuedAt: '2026-09-30T08:00:00Z' }],
    }} />));
    expect(container.textContent).toContain('失联');
    expect(container.textContent).toContain('等待本地确认停止');
    const cancel = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '请求取消');
    expect(cancel?.disabled).toBe(true);
  });

  it('只给有权限的阻塞会话显示恢复入口', async () => {
    const onCommand = vi.fn();
    const session = { id: 's1', workflowRunId: 'w1', status: 'BLOCKED' as const, executorType: 'LOCAL' as const,
      sourceTool: 'codex' as const, protocolVersion: '1.2', traceId: 't1', createdAt: '', updatedAt: '',
      blockedReason: '等待接口定义', canControl: true };
    await act(async () => root?.render(<ExecutionSessionPanel evidence={[]} session={session} onCommand={onCommand} />));
    expect(container.textContent).toContain('等待接口定义');
    await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '请求恢复')?.click());
    expect(onCommand).toHaveBeenCalledWith('RESUME');
    await act(async () => root?.render(<ExecutionSessionPanel evidence={[]} session={{ ...session, canControl: false }} onCommand={onCommand} />));
    expect(container.textContent).not.toContain('请求恢复');
  });

});
