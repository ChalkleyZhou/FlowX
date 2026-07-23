import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from './adapter-registry.js';
import type { ToolAdapter } from './tool-adapter.js';

describe('AdapterRegistry', () => {
  it('resolves a registered adapter by name', () => {
    const adapter: ToolAdapter<unknown, { ok: true }> = {
      name: 'cursor',
      capabilities: ['repo-open', 'chat-handoff', 'completion-report'],
      launch: async () => ({ ok: true }),
    };
    const registry = new AdapterRegistry([adapter]);
    expect(registry.resolve('cursor')).toBe(adapter);
  });

  it('throws for unknown tools', () => {
    const registry = new AdapterRegistry([]);
    expect(() => registry.resolve('unknown')).toThrow(/unknown tool/i);
  });
});
