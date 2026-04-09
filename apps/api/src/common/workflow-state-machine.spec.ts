import { describe, expect, it } from 'vitest';
import { StageExecutionStatus, StageType, WorkflowRunStatus } from './enums';
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

  it('rejects skipping directly from created to plan pending', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.CREATED,
        WorkflowRunStatus.PLAN_PENDING,
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

  it('rejects completed stage executions from moving again', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionStage(
        StageExecutionStatus.COMPLETED,
        StageExecutionStatus.RUNNING,
      ),
    ).toBe(false);
  });

  it('allows technical plan stage while plan is waiting for confirmation', () => {
    const machine = new WorkflowStateMachine();

    expect(() =>
      machine.assertStageMatchesWorkflow(
        StageType.TECHNICAL_PLAN,
        WorkflowRunStatus.PLAN_WAITING_CONFIRMATION,
      ),
    ).not.toThrow();
  });

  it('throws when a stage does not match the workflow status', () => {
    const machine = new WorkflowStateMachine();

    expect(() =>
      machine.assertStageMatchesWorkflow(
        StageType.TECHNICAL_PLAN,
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
});
