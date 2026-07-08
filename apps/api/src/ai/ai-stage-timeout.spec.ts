import { describe, expect, it } from 'vitest';
import { resolveOptionalTimeoutMs } from './codex-ai.executor';

describe('resolveOptionalTimeoutMs', () => {
  it('returns default when env is unset or blank', () => {
    expect(resolveOptionalTimeoutMs(undefined, 0)).toBe(0);
    expect(resolveOptionalTimeoutMs('   ', 600_000)).toBe(600_000);
  });

  it('parses non-negative integers', () => {
    expect(resolveOptionalTimeoutMs('0', 600_000)).toBe(0);
    expect(resolveOptionalTimeoutMs('1800000', 0)).toBe(1_800_000);
  });

  it('falls back to default for invalid values', () => {
    expect(resolveOptionalTimeoutMs('not-a-number', 0)).toBe(0);
    expect(resolveOptionalTimeoutMs('-1', 600_000)).toBe(600_000);
  });
});
