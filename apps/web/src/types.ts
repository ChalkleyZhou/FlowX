export interface Requirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export interface StageExecution {
  id: string;
  stage: string;
  status: string;
  attempt: number;
  output: unknown;
}

export interface WorkflowRun {
  id: string;
  status: string;
  requirement: Requirement;
  tasks: Array<{ id: string; title: string; description: string; status: string }>;
  plan?: {
    summary: string;
    implementationPlan: string[];
    filesToModify: string[];
    newFiles: string[];
    riskPoints: string[];
    status: string;
  };
  codeExecution?: {
    patchSummary: string;
    changedFiles: string[];
    codeChanges: unknown[];
    status: string;
  };
  reviewReport?: {
    issues: string[];
    bugs: string[];
    missingTests: string[];
    suggestions: string[];
    impactScope: string[];
    status: string;
  };
  stageExecutions: StageExecution[];
}

