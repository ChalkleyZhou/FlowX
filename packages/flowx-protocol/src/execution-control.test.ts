import { describe, expect, it } from 'vitest';
import { canTransitionExecutionSession, getExecutionHealth } from './index.js';

describe('执行状态和健康状态', () => {
  it('阻塞只能恢复运行或结束，不能直接完成', () => {
    expect(canTransitionExecutionSession('RUNNING', 'BLOCKED')).toBe(true);
    expect(canTransitionExecutionSession('BLOCKED', 'RUNNING')).toBe(true);
    expect(canTransitionExecutionSession('BLOCKED', 'COMPLETED')).toBe(false);
    expect(canTransitionExecutionSession('CANCELLED', 'RUNNING')).toBe(false);
  });
  it('仅已接入检查点的活动会话根据服务端心跳判定失联', () => {
    const now = new Date('2026-09-30T08:00:00Z');
    const row = { status: 'RUNNING', controlMode: 'COOPERATIVE', lastHeartbeatAt: new Date(now.getTime() - 300_000) };
    expect(getExecutionHealth(row, now)).toBe('STALE');
    expect(getExecutionHealth({ ...row, controlMode: 'NONE' }, now)).toBe('UNKNOWN');
    expect(getExecutionHealth({ ...row, status: 'COMPLETED' }, now)).toBe('TERMINAL');
    expect(getExecutionHealth({ ...row, lastHeartbeatAt: now }, now)).toBe('ONLINE');
  });
});
