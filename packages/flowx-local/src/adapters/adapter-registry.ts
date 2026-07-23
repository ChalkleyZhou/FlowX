import type { ToolAdapter } from './tool-adapter.js';

export class AdapterRegistry {
  private readonly byName = new Map<string, ToolAdapter<any, any>>();

  constructor(adapters: Array<ToolAdapter<any, any>>) {
    for (const adapter of adapters) {
      this.byName.set(adapter.name, adapter);
    }
  }

  resolve(name: string): ToolAdapter<any, any> {
    const adapter = this.byName.get(name);
    if (!adapter) {
      throw new Error(`Unknown tool adapter: ${name}`);
    }
    return adapter;
  }

  list(): string[] {
    return [...this.byName.keys()];
  }
}
