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

  it('routes repository grounding into brainstorm before task split', () => {
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
        WorkflowRunStatus.TASK_SPLIT_PENDING,
      ),
    ).toBe(false);
  });

  it('routes design through waiting confirmation before demo, and demo before task split', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.BRAINSTORM_PENDING,
        WorkflowRunStatus.DESIGN_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DESIGN_PENDING,
        WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DESIGN_PENDING,
        WorkflowRunStatus.DEMO_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
        WorkflowRunStatus.DEMO_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
        WorkflowRunStatus.DESIGN_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DEMO_PENDING,
        WorkflowRunStatus.DEMO_WAITING_CONFIRMATION,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DEMO_PENDING,
        WorkflowRunStatus.TASK_SPLIT_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DEMO_WAITING_CONFIRMATION,
        WorkflowRunStatus.TASK_SPLIT_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.DEMO_WAITING_CONFIRMATION,
        WorkflowRunStatus.DEMO_PENDING,
      ),
    ).toBe(true);
  });

  it('allows optional-stage executions to be skipped from waiting confirmation', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionStage(StageExecutionStatus.WAITING_CONFIRMATION, StageExecutionStatus.SKIPPED),
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

  it('allows rolling back to the previous pipeline stage for debugging', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.PLAN_CONFIRMED,
        WorkflowRunStatus.TASK_SPLIT_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.EXECUTION_PENDING,
        WorkflowRunStatus.PLAN_PENDING,
      ),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(WorkflowRunStatus.DONE, WorkflowRunStatus.HUMAN_REVIEW_PENDING),
    ).toBe(true);
    expect(
      machine.canTransitionWorkflow(WorkflowRunStatus.FAILED, WorkflowRunStatus.PLAN_PENDING),
    ).toBe(true);
  });
});
