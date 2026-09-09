import type { ToolAdapter } from './tool-adapter.js';
import {
  launchIde,
  type IdeAdapterDeps,
  type IdeAdapterLaunchInput,
  type IdeLaunchResult,
} from './ide-launch.js';

export type { IdeLaunchInput, IdeLaunchResult } from './ide-launch.js';

export class WorkBuddyAdapter implements ToolAdapter<IdeAdapterLaunchInput, IdeLaunchResult> {
  readonly name = 'workbuddy';
  readonly capabilities = ['repo-open', 'chat-handoff', 'completion-report'] as const;

  constructor(private readonly deps: IdeAdapterDeps = {}) {}

  launch(input: IdeAdapterLaunchInput): Promise<IdeLaunchResult> {
    return launchIde({ ...input, ide: 'workbuddy' }, this.deps);
  }
}
