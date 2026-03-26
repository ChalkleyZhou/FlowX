export enum WorkflowRunStatus {
  CREATED = 'created',
  TASK_SPLIT_PENDING = 'task_split_pending',
  TASK_SPLIT_WAITING_CONFIRMATION = 'task_split_waiting_confirmation',
  TASK_SPLIT_CONFIRMED = 'task_split_confirmed',
  PLAN_PENDING = 'plan_pending',
  PLAN_WAITING_CONFIRMATION = 'plan_waiting_confirmation',
  PLAN_CONFIRMED = 'plan_confirmed',
  EXECUTION_PENDING = 'execution_pending',
  EXECUTION_RUNNING = 'execution_running',
  REVIEW_PENDING = 'review_pending',
  HUMAN_REVIEW_PENDING = 'human_review_pending',
  DONE = 'done',
  FAILED = 'failed',
}

export enum StageType {
  REQUIREMENT_INTAKE = 'requirement_intake',
  TASK_SPLIT = 'task_split',
  TECHNICAL_PLAN = 'technical_plan',
  EXECUTION = 'execution',
  AI_REVIEW = 'ai_review',
  HUMAN_REVIEW = 'human_review',
}

export enum StageExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  WAITING_CONFIRMATION = 'waiting_confirmation',
  REJECTED = 'rejected',
}

export enum TaskStatus {
  DRAFT = 'draft',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}

export enum PlanStatus {
  DRAFT = 'draft',
  WAITING_HUMAN_CONFIRMATION = 'waiting_human_confirmation',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}

export enum CodeExecutionStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  WAITING_HUMAN_REVIEW = 'waiting_human_review',
}

export enum ReviewReportStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
  WAITING_HUMAN_REVIEW = 'waiting_human_review',
}

export enum RequirementStatus {
  ACTIVE = 'active',
}

export enum HumanReviewDecision {
  ACCEPT = 'accept',
  REWORK = 'rework',
  ROLLBACK = 'rollback',
  CONTINUE = 'continue',
}

