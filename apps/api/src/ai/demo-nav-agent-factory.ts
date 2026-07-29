import type { AIExecutor, AIInvocationContext } from './ai-executor';
import type { CodexAiExecutor } from './codex-ai.executor';
import type { NavPlacementAgent } from '../common/demo-router-integration';

/** Uses whichever executor is driving the run (Codex / Cursor both inherit this). Mock has no implementation → heuristic-only. */
export function createNavPlacementAgent(
  executor: AIExecutor,
  invocationContext?: AIInvocationContext,
): NavPlacementAgent | undefined {
  const nav = executor as Partial<CodexAiExecutor>;
  if (typeof nav.placeDemoNavigation !== 'function') {
    return undefined;
  }
  return (input) => nav.placeDemoNavigation!(input, invocationContext);
}
