import { describe, expect, it, vi } from 'vitest';
import { dispatchStageAction, type StageActionDeps } from './run-detail-actions';
import type { FlowXClient } from './flowx-client';

function makeClient() {
  return {
    confirmPlan: vi.fn().mockResolvedValue({}),
    reviseDesign: vi.fn().mockResolvedValue({}),
    runExecution: vi.fn().mockResolvedValue({}),
    decideHumanReview: vi.fn().mockResolvedValue({}),
  } as unknown as FlowXClient;
}

function makeDeps(): StageActionDeps {
  return {
    claimLocalExecution: vi.fn().mockResolvedValue(undefined),
    cancelLocalExecution: vi.fn().mockResolvedValue(undefined),
    completeLocalExecution: vi.fn().mockResolvedValue(undefined),
    generateLocalDesign: vi.fn().mockResolvedValue(undefined),
    submitLocalDesign: vi.fn().mockResolvedValue(undefined),
  };
}

describe('dispatchStageAction local design', () => {
  it('delegates design localGenerate/localSubmit to deps', async () => {
    const client = makeClient();
    const deps = makeDeps();
    await dispatchStageAction(client, deps, { runId: 'run-1', stageKey: 'DESIGN', kind: 'localGenerate' });
    expect(deps.generateLocalDesign).toHaveBeenCalledWith('run-1');
    await dispatchStageAction(client, deps, { runId: 'run-1', stageKey: 'DESIGN', kind: 'localSubmit' });
    expect(deps.submitLocalDesign).toHaveBeenCalledWith('run-1');
  });
});

describe('dispatchStageAction', () => {
  it('routes plan confirm to the client', async () => {
    const client = makeClient();
    await dispatchStageAction(client, makeDeps(), { runId: 'run-1', stageKey: 'TECHNICAL_PLAN', kind: 'confirm' });
    expect(client.confirmPlan).toHaveBeenCalledWith('run-1');
  });

  it('passes feedback to revise and rejects empty feedback', async () => {
    const client = makeClient();
    await dispatchStageAction(client, makeDeps(), {
      runId: 'run-1',
      stageKey: 'DESIGN',
      kind: 'revise',
      feedback: '加深主色',
    });
    expect(client.reviseDesign).toHaveBeenCalledWith('run-1', '加深主色');

    await expect(
      dispatchStageAction(client, makeDeps(), { runId: 'run-1', stageKey: 'DESIGN', kind: 'revise', feedback: '  ' }),
    ).rejects.toThrow(/修改意见/);
  });

  it('delegates execution claim/cancel/complete to deps but runs cloud execution via client', async () => {
    const client = makeClient();
    const deps = makeDeps();
    await dispatchStageAction(client, deps, { runId: 'run-1', stageKey: 'EXECUTION', kind: 'claim' });
    expect(deps.claimLocalExecution).toHaveBeenCalledWith('run-1');

    await dispatchStageAction(client, deps, { runId: 'run-1', stageKey: 'EXECUTION', kind: 'run' });
    expect(client.runExecution).toHaveBeenCalledWith('run-1');
  });

  it('passes the decision to human review', async () => {
    const client = makeClient();
    await dispatchStageAction(client, makeDeps(), {
      runId: 'run-1',
      stageKey: 'HUMAN_REVIEW',
      kind: 'decide',
      decision: 'accept',
    });
    expect(client.decideHumanReview).toHaveBeenCalledWith('run-1', 'accept');
  });

  it('throws on an unsupported stage/kind combination', async () => {
    await expect(
      dispatchStageAction(makeClient(), makeDeps(), { runId: 'run-1', stageKey: 'BRAINSTORM', kind: 'confirm' }),
    ).rejects.toThrow(/Unsupported/);
  });
});
