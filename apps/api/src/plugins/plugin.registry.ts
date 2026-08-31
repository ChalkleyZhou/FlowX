import { Injectable } from '@nestjs/common';
import type { BuiltInPlugin } from './plugin.types';

@Injectable()
export class BuiltInPluginRegistry {
  private readonly plugins = new Map<string, BuiltInPlugin>();

  register(plugin: BuiltInPlugin) {
    this.plugins.set(plugin.id, plugin);
  }

  list() {
    return [...this.plugins.values()];
  }
}
