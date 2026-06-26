import { describe, expect, it } from 'vitest';
import { buildRunDetailModel, deriveExecutionClaim } from './run-detail-model';
import type { WorkflowRunDetail, WorkflowStageExecution } from './flowx-client';

function makeRun(status: string, stageExecutions: WorkflowStageExecution[] = []): WorkflowRunDetail {
  return {
    id: 'run-1',
    status,
    requirement: { id: 'req-1', title: '导出 CSV' },
    stageExecutions,
  };
}

function actionIds(model: ReturnType<typeof buildRunDetailModel>, key: string): string[] {
  return model.timeline.find((item) => item.key === key)?.actions.map((action) => action.id) ?? [];
}

describe('buildRunDetailModel action gating', () => {
  it('offers confirm/reject/revise only when design is waiting for confirmation', () => {
    expect(actionIds(buildRunDetailModel(makeRun('DESIGN_PENDING')), 'DESIGN')).toEqual([
      'design.localGenerate',
      'design.localSubmit',
      'design.run',
    ]);
    expect(actionIds(buildRunDetailModel(makeRun('DESIGN_WAITING_CONFIRMATION')), 'DESIGN')).toEqual([
      'design.confirm',
      'design.reject',
      'design.revise',
    ]);
  });

  it('offers confirm/reject/revise only when plan is waiting for confirmation', () => {
    expect(actionIds(buildRunDetailModel(makeRun('PLAN_WAITING_CONFIRMATION')), 'TECHNICAL_PLAN')).toEqual([
      'plan.confirm',
      'plan.reject',
      'plan.revise',
    ]);
  });

  it('offers claim + cloud run while execution is pending', () => {
    expect(actionIds(buildRunDetailModel(makeRun('EXECUTION_PENDING')), 'EXECUTION')).toEqual([
      'execution.claim',
      'execution.run',
    ]);
  });

  it('offers complete/cancel only when a local claim is active during EXECUTION_RUNNING', () => {
    const localClaim = buildRunDetailModel(
      makeRun('EXECUTION_RUNNING', [
        { stage: 'EXECUTION', status: 'RUNNING', attempt: 1, input: { executor: 'LOCAL', claimedByUserId: 'u-9' } },
      ]),
    );
    expect(actionIds(localClaim, 'EXECUTION')).toEqual(['execution.complete', 'execution.cancel']);

    const cloudRunning = buildRunDetailModel(
      makeRun('EXECUTION_RUNNING', [
        { stage: 'EXECUTION', status: 'RUNNING', attempt: 1, input: { executor: 'CLOUD' } },
      ]),
    );
    expect(actionIds(cloudRunning, 'EXECUTION')).toEqual([]);
  });

  it('offers human-review decisions only when human review is pending', () => {
    const model = buildRunDetailModel(makeRun('HUMAN_REVIEW_PENDING'));
    expect(actionIds(model, 'HUMAN_REVIEW')).toEqual(['humanReview.accept', 'humanReview.rework']);
    const accept = model.timeline.find((i) => i.key === 'HUMAN_REVIEW')?.actions[0];
    expect(accept?.decision).toBe('accept');
  });

  it('marks only the current stage and gives non-current stages no actions', () => {
    const model = buildRunDetailModel(makeRun('PLAN_WAITING_CONFIRMATION'));
    const current = model.timeline.filter((item) => item.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]?.key).toBe('TECHNICAL_PLAN');
    expect(actionIds(model, 'DESIGN')).toEqual([]);
  });
});

describe('deriveExecutionClaim', () => {
  it('detects a local claim and its owner from the latest EXECUTION stage input', () => {
    const claim = deriveExecutionClaim(
      makeRun('EXECUTION_RUNNING', [
        { stage: 'EXECUTION', status: 'RUNNING', attempt: 2, input: { executor: 'LOCAL', claimedByUserId: 'u-9', claimedAt: 't' } },
        { stage: 'EXECUTION', status: 'FAILED', attempt: 1, input: { executor: 'CLOUD' } },
      ]),
    );
    expect(claim.claimed).toBe(true);
    expect(claim.executor).toBe('LOCAL');
    expect(claim.claimedByUserId).toBe('u-9');
  });

  it('reports not claimed when there is no running local execution stage', () => {
    expect(deriveExecutionClaim(makeRun('EXECUTION_PENDING')).claimed).toBe(false);
  });
});
