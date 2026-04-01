import { HumanReviewDecision, StageType } from './enums';

export interface RequirementRecord {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export interface RepositoryContext {
  id: string;
  name: string;
  url: string;
  defaultBranch?: string | null;
  currentBranch?: string | null;
  localPath?: string | null;
  syncStatus?: string | null;
  contextSnapshot?: {
    strategy?: string;
    summary?: string;
    evidenceFiles?: string[];
  } | null;
}

export interface WorkspaceContext {
  id: string;
  name: string;
  description?: string | null;
  repositories: RepositoryContext[];
}

export interface WorkflowRepositoryContext extends RepositoryContext {
  baseBranch?: string | null;
  workingBranch?: string | null;
}

export interface SplitTasksInput {
  requirement: RequirementRecord;
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
  previousOutput?: SplitTasksOutput | null;
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
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
  previousOutput?: GeneratePlanOutput | null;
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
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
}

export interface ExecuteTaskOutput {
  patchSummary: string;
  changedFiles: string[];
  codeChanges: Array<{
    file: string;
    changeType: 'create' | 'update';
    summary: string;
  }>;
  diffArtifacts: Array<{
    repository: string;
    branch: string;
    localPath: string;
    diffStat: string;
    diffText: string;
    untrackedFiles: string[];
  }>;
}

export interface ReviewCodeInput {
  requirement: RequirementRecord;
  plan: GeneratePlanOutput;
  execution: ExecuteTaskOutput;
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
  previousOutput?: ReviewCodeOutput | null;
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
