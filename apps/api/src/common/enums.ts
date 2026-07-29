export enum WorkflowRunType {
  FULL = 'FULL',
  BUG_FIX = 'BUG_FIX',
  LOCAL_CHAT = 'LOCAL_CHAT',
  LOCAL_DESIGN = 'LOCAL_DESIGN',
}

export enum WorkflowRunStatus {
  CREATED = 'created',
  REPOSITORY_GROUNDING_PENDING = 'repository_grounding_pending',
  BRAINSTORM_PENDING = 'brainstorm_pending',
  DESIGN_PENDING = 'design_pending',
  DESIGN_WAITING_CONFIRMATION = 'design_waiting_confirmation',
  SPEC_PLAN_PENDING = 'spec_plan_pending',
  SPEC_PLAN_WAITING_CONFIRMATION = 'spec_plan_waiting_confirmation',
  SPEC_PLAN_CONFIRMED = 'spec_plan_confirmed',
  EXECUTION_PENDING = 'execution_pending',
  EXECUTION_RUNNING = 'execution_running',
  REVIEW_PENDING = 'review_pending',
  HUMAN_REVIEW_PENDING = 'human_review_pending',
  DONE = 'done',
  FAILED = 'failed',
}

export enum StageType {
  REQUIREMENT_INTAKE = 'requirement_intake',
  REPOSITORY_GROUNDING = 'repository_grounding',
  BRAINSTORM = 'brainstorm',
  DESIGN = 'design',
  SPEC_PLAN = 'spec_plan',
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
  SKIPPED = 'skipped',
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

export enum IdeationStatus {
  NONE = 'NONE',
  BRAINSTORM_PENDING = 'BRAINSTORM_PENDING',
  BRAINSTORM_WAITING_CONFIRMATION = 'BRAINSTORM_WAITING_CONFIRMATION',
  BRAINSTORM_CONFIRMED = 'BRAINSTORM_CONFIRMED',
  DESIGN_PENDING = 'DESIGN_PENDING',
  DESIGN_WAITING_CONFIRMATION = 'DESIGN_WAITING_CONFIRMATION',
  DESIGN_CONFIRMED = 'DESIGN_CONFIRMED',
  FINALIZED = 'FINALIZED',
}

export enum IdeationStage {
  BRAINSTORM = 'BRAINSTORM',
  DESIGN = 'DESIGN',
}

export enum IdeationSessionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  WAITING_CONFIRMATION = 'WAITING_CONFIRMATION',
}

export enum RequirementPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum RequirementPlanningStatus {
  UNSCHEDULED = 'UNSCHEDULED',
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export enum RequirementAssignmentRole {
  PM = 'PM',
  FRONTEND = 'FRONTEND',
  BACKEND = 'BACKEND',
  FULLSTACK = 'FULLSTACK',
  QA = 'QA',
  DESIGN = 'DESIGN',
  OTHER = 'OTHER',
}
