import { BadRequestException, Injectable } from '@nestjs/common';
import { StageExecutionStatus, StageType, WorkflowRunStatus } from './enums';

const workflowTransitions: Record<WorkflowRunStatus, WorkflowRunStatus[]> = {
  [WorkflowRunStatus.CREATED]: [WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING],
  [WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING]: [
    WorkflowRunStatus.TASK_SPLIT_PENDING,
    WorkflowRunStatus.FAILED,
  ],
  [WorkflowRunStatus.TASK_SPLIT_PENDING]: [
    WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION,
    WorkflowRunStatus.FAILED,
  ],
  [WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION]: [
    WorkflowRunStatus.TASK_SPLIT_CONFIRMED,
    WorkflowRunStatus.TASK_SPLIT_PENDING,
    WorkflowRunStatus.FAILED,
  ],
  [WorkflowRunStatus.TASK_SPLIT_CONFIRMED]: [WorkflowRunStatus.PLAN_PENDING],
  [WorkflowRunStatus.PLAN_PENDING]: [
    WorkflowRunStatus.PLAN_WAITING_CONFIRMATION,
    WorkflowRunStatus.FAILED,
  ],
  [WorkflowRunStatus.PLAN_WAITING_CONFIRMATION]: [
    WorkflowRunStatus.PLAN_CONFIRMED,
    WorkflowRunStatus.PLAN_PENDING,
    WorkflowRunStatus.FAILED,
  ],
  [WorkflowRunStatus.PLAN_CONFIRMED]: [WorkflowRunStatus.EXECUTION_PENDING],
  [WorkflowRunStatus.EXECUTION_PENDING]: [
    WorkflowRunStatus.EXECUTION_RUNNING,
    WorkflowRunStatus.FAILED,
  ],
  [WorkflowRunStatus.EXECUTION_RUNNING]: [
    WorkflowRunStatus.REVIEW_PENDING,
    WorkflowRunStatus.EXECUTION_PENDING,
    WorkflowRunStatus.FAILED,
  ],
  [WorkflowRunStatus.REVIEW_PENDING]: [
    WorkflowRunStatus.HUMAN_REVIEW_PENDING,
    WorkflowRunStatus.FAILED,
  ],
  [WorkflowRunStatus.HUMAN_REVIEW_PENDING]: [
    WorkflowRunStatus.DONE,
    WorkflowRunStatus.EXECUTION_PENDING,
    WorkflowRunStatus.FAILED,
  ],
  [WorkflowRunStatus.DONE]: [WorkflowRunStatus.EXECUTION_PENDING, WorkflowRunStatus.REVIEW_PENDING],
  [WorkflowRunStatus.FAILED]: [],
};

const stageTransitions: Record<StageExecutionStatus, StageExecutionStatus[]> = {
  [StageExecutionStatus.PENDING]: [StageExecutionStatus.RUNNING],
  [StageExecutionStatus.RUNNING]: [
    StageExecutionStatus.WAITING_CONFIRMATION,
    StageExecutionStatus.COMPLETED,
    StageExecutionStatus.FAILED,
  ],
  [StageExecutionStatus.WAITING_CONFIRMATION]: [
    StageExecutionStatus.COMPLETED,
    StageExecutionStatus.REJECTED,
  ],
  [StageExecutionStatus.COMPLETED]: [],
  [StageExecutionStatus.FAILED]: [],
  [StageExecutionStatus.REJECTED]: [],
};

@Injectable()
export class WorkflowStateMachine {
  canTransitionWorkflow(from: WorkflowRunStatus, to: WorkflowRunStatus): boolean {
    return workflowTransitions[from].includes(to);
  }

  canTransitionStage(from: StageExecutionStatus, to: StageExecutionStatus): boolean {
    return stageTransitions[from].includes(to);
  }

  assertWorkflowTransition(from: WorkflowRunStatus, to: WorkflowRunStatus): void {
    if (!this.canTransitionWorkflow(from, to)) {
      throw new BadRequestException(`Illegal workflow transition: ${from} -> ${to}`);
    }
  }

  assertStageTransition(from: StageExecutionStatus, to: StageExecutionStatus): void {
    if (!this.canTransitionStage(from, to)) {
      throw new BadRequestException(`Illegal stage transition: ${from} -> ${to}`);
    }
  }

  assertStageMatchesWorkflow(stage: StageType, status: WorkflowRunStatus): void {
    const allowed: Record<StageType, WorkflowRunStatus[]> = {
      [StageType.REQUIREMENT_INTAKE]: [WorkflowRunStatus.CREATED],
      [StageType.REPOSITORY_GROUNDING]: [WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING],
      [StageType.TASK_SPLIT]: [
        WorkflowRunStatus.TASK_SPLIT_PENDING,
        WorkflowRunStatus.TASK_SPLIT_WAITING_CONFIRMATION,
      ],
      [StageType.TECHNICAL_PLAN]: [
        WorkflowRunStatus.PLAN_PENDING,
        WorkflowRunStatus.PLAN_WAITING_CONFIRMATION,
      ],
      [StageType.EXECUTION]: [
        WorkflowRunStatus.EXECUTION_PENDING,
        WorkflowRunStatus.EXECUTION_RUNNING,
        WorkflowRunStatus.DONE,
      ],
      [StageType.AI_REVIEW]: [
        WorkflowRunStatus.REVIEW_PENDING,
        WorkflowRunStatus.HUMAN_REVIEW_PENDING,
        WorkflowRunStatus.DONE,
      ],
      [StageType.HUMAN_REVIEW]: [WorkflowRunStatus.HUMAN_REVIEW_PENDING],
    };

    if (!allowed[stage].includes(status)) {
      throw new BadRequestException(
        `Workflow status ${status} does not allow stage ${stage}`,
      );
    }
  }
}
