import type { FlowXClient } from './flowx-client';
import type { StageActionKind, StageKey } from './run-detail-model';

export interface StageActionRequest {
  runId: string;
  stageKey: StageKey;
  kind: StageActionKind;
  decision?: string;
  feedback?: string;
}

/**
 * Execution claim / cancel / complete need local orchestration (git, local agent prompt),
 * so the extension provides these; everything else maps directly to a FlowXClient REST call.
 */
export interface StageActionDeps {
  claimLocalExecution(runId: string): Promise<void>;
  cancelLocalExecution(runId: string): Promise<void>;
  completeLocalExecution(runId: string): Promise<void>;
  /** Hand the OpenDesign-MCP design prompt to the local agent. */
  generateLocalDesign(runId: string): Promise<void>;
  /** Read the agent-written design output and submit it to FlowX. */
  submitLocalDesign(runId: string): Promise<void>;
}

/** Map a stage action request to the right FlowXClient call (or local orchestration dep). Pure + testable. */
export async function dispatchStageAction(
  client: FlowXClient,
  deps: StageActionDeps,
  request: StageActionRequest,
): Promise<void> {
  const { runId, stageKey, kind, decision, feedback } = request;

  switch (stageKey) {
    case 'DESIGN':
      if (kind === 'run') return void (await client.runDesign(runId));
      if (kind === 'confirm') return void (await client.confirmDesign(runId));
      if (kind === 'reject') return void (await client.rejectDesign(runId));
      if (kind === 'revise') return void (await client.reviseDesign(runId, requireFeedback(feedback)));
      if (kind === 'localGenerate') return deps.generateLocalDesign(runId);
      if (kind === 'localSubmit') return deps.submitLocalDesign(runId);
      break;
    case 'SPEC_PLAN':
      if (kind === 'run') return void (await client.runSpecPlan(runId));
      if (kind === 'confirm') return void (await client.confirmSpecPlan(runId));
      if (kind === 'reject') return void (await client.rejectSpecPlan(runId));
      if (kind === 'revise') return void (await client.reviseSpecPlan(runId, requireFeedback(feedback)));
      break;
    case 'EXECUTION':
      if (kind === 'run') return void (await client.runExecution(runId));
      if (kind === 'claim') return deps.claimLocalExecution(runId);
      if (kind === 'cancel') return deps.cancelLocalExecution(runId);
      if (kind === 'complete') return deps.completeLocalExecution(runId);
      break;
    case 'AI_REVIEW':
      if (kind === 'run') return void (await client.runReview(runId));
      break;
    case 'HUMAN_REVIEW':
      if (kind === 'decide') return void (await client.decideHumanReview(runId, requireDecision(decision)));
      break;
    default:
      break;
  }

  throw new Error(`Unsupported stage action: ${stageKey}/${kind}`);
}

function requireFeedback(feedback?: string): string {
  const value = feedback?.trim();
  if (!value) {
    throw new Error('修改意见不能为空。');
  }
  return value;
}

function requireDecision(decision?: string): string {
  if (!decision?.trim()) {
    throw new Error('缺少人工审核决定。');
  }
  return decision.trim();
}
