import { describe, expect, it } from 'vitest';
import { StageExecutionStatus, StageType, WorkflowRunStatus, WorkflowRunType } from './enums';
import { WorkflowStateMachine } from './workflow-state-machine';

describe('WorkflowStateMachine', () => {
  it('allows created to transition into repository grounding', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.CREATED,
        WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
      ),
    ).toBe(true);
  });

  it('allows local chat workflow bootstrap like bug fix workflows', () => {
    const machine = new WorkflowStateMachine();

    expect(machine.canBootstrapLocalChatWorkflow(WorkflowRunType.LOCAL_CHAT)).toBe(true);
    expect(machine.canBootstrapLocalChatWorkflow(WorkflowRunType.FULL)).toBe(false);
  });

  it('routes repository grounding into brainstorm before spec plan', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
        WorkflowRunStatus.BRAINSTORM_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
        WorkflowRunStatus.SPEC_PLAN_PENDING,
      ),
    ).toBe(false);
  });

  it('allows local design workflows to advance directly from grounding to design', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
        WorkflowRunStatus.DESIGN_PENDING,
      ),
    ).toBe(true);
  });

  it('routes design through waiting confirmation into spec plan, then execution', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
        WorkflowRunStatus.SPEC_PLAN_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DESIGN_PENDING,
        WorkflowRunStatus.SPEC_PLAN_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
        'demo_pending' as WorkflowRunStatus,
      ),
    ).toBe(false);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.SPEC_PLAN_PENDING,
        WorkflowRunStatus.SPEC_PLAN_WAITING_CONFIRMATION,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.SPEC_PLAN_WAITING_CONFIRMATION,
        WorkflowRunStatus.SPEC_PLAN_CONFIRMED,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.SPEC_PLAN_CONFIRMED,
        WorkflowRunStatus.EXECUTION_PENDING,
      ),
    ).toBe(true);
  });

  it('does not allow skipping from design directly to execution', () => {
    const machine = new WorkflowStateMachine();
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
        WorkflowRunStatus.EXECUTION_PENDING,
      ),
    ).toBe(false);
  });

  it('allows optional-stage executions to be skipped from waiting confirmation', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionStage(StageExecutionStatus.WAITING_CONFIRMATION, StageExecutionStatus.SKIPPED),
    ).toBe(true);
  });

  it('rejects skipping directly from created to spec plan pending', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.CREATED,
        WorkflowRunStatus.SPEC_PLAN_PENDING,
      ),
    ).toBe(false);
  });

  it('allows running stage executions to move into waiting confirmation', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionStage(
        StageExecutionStatus.RUNNING,
        StageExecutionStatus.WAITING_CONFIRMATION,
      ),
    ).toBe(true);
  });

  it('allows pending optional stage executions to be skipped', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionStage(
        StageExecutionStatus.PENDING,
        StageExecutionStatus.SKIPPED,
      ),
    ).toBe(true);
  });

  it('rejects completed stage executions from moving again', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionStage(
        StageExecutionStatus.COMPLETED,
        StageExecutionStatus.RUNNING,
      ),
    ).toBe(false);
  });

  it('allows spec plan stage while spec plan is waiting for confirmation', () => {
    const machine = new WorkflowStateMachine();

    expect(() =>
      machine.assertStageMatchesWorkflow(
        StageType.SPEC_PLAN,
        WorkflowRunStatus.SPEC_PLAN_WAITING_CONFIRMATION,
      ),
    ).not.toThrow();
  });

  it('throws when a stage does not match the workflow status', () => {
    const machine = new WorkflowStateMachine();

    expect(() =>
      machine.assertStageMatchesWorkflow(
        StageType.SPEC_PLAN,
        WorkflowRunStatus.EXECUTION_RUNNING,
      ),
    ).toThrow(/does not allow stage/i);
  });

  it('throws on illegal workflow transitions', () => {
    const machine = new WorkflowStateMachine();

    expect(() =>
      machine.assertWorkflowTransition(
        WorkflowRunStatus.CREATED,
        WorkflowRunStatus.EXECUTION_PENDING,
      ),
    ).toThrow(/Illegal workflow transition/i);
  });

  it('allows rolling back to the previous pipeline stage for debugging', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.SPEC_PLAN_CONFIRMED,
        WorkflowRunStatus.SPEC_PLAN_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.EXECUTION_PENDING,
        WorkflowRunStatus.SPEC_PLAN_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(WorkflowRunStatus.DONE, WorkflowRunStatus.HUMAN_REVIEW_PENDING),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(WorkflowRunStatus.FAILED, WorkflowRunStatus.SPEC_PLAN_PENDING),
    ).toBe(true);
  });
});
