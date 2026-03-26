import { HumanReviewDecision, StageType } from './enums';

export interface RequirementRecord {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export interface SplitTasksInput {
  requirement: RequirementRecord;
}

export interface SplitTaskItem {
  title: string;
  description: string;
}

export interface SplitTasksOutput {
  tasks: SplitTaskItem[];
  ambiguities: string[];
  risks: string[];
}

export interface GeneratePlanInput {
  requirement: RequirementRecord;
  tasks: SplitTaskItem[];
}

export interface GeneratePlanOutput {
  summary: string;
  implementationPlan: string[];
  filesToModify: string[];
  newFiles: string[];
  riskPoints: string[];
}

export interface ExecuteTaskInput {
  requirement: RequirementRecord;
  tasks: SplitTaskItem[];
  plan: GeneratePlanOutput;
}

export interface ExecuteTaskOutput {
  patchSummary: string;
  changedFiles: string[];
  codeChanges: Array<{
    file: string;
    changeType: 'create' | 'update';
    summary: string;
  }>;
}

export interface ReviewCodeInput {
  requirement: RequirementRecord;
  plan: GeneratePlanOutput;
  execution: ExecuteTaskOutput;
}

export interface ReviewCodeOutput {
  issues: string[];
  bugs: string[];
  missingTests: string[];
  suggestions: string[];
  impactScope: string[];
}

export interface PromptTemplate {
  name: string;
  version: string;
  system: string;
  user: string;
}

export interface StageHistoryRecord {
  stage: StageType;
  status: string;
  input: unknown;
  output: unknown;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface HumanReviewDecisionInput {
  decision: HumanReviewDecision;
}

