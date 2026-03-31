export interface Project {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  workspace: Workspace;
  requirements?: Requirement[];
  _count?: {
    requirements: number;
  };
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  project: Project;
  workspace?: Workspace | null;
  workflowRuns?: Array<{
    id: string;
    status: string;
    workflowRepositories?: Array<{
      id: string;
      name: string;
      repositoryId?: string | null;
      status: string;
    }>;
  }>;
  requirementRepositories?: Array<{
    id: string;
    repository: Repository;
  }>;
}

export interface Repository {
  id: string;
  name: string;
  url: string;
  defaultBranch?: string | null;
  currentBranch?: string | null;
  localPath?: string | null;
  syncStatus?: string;
  syncError?: string | null;
  lastSyncedAt?: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string | null;
  repositories: Repository[];
  _count?: {
    projects: number;
    requirements: number;
  };
}

export interface StageExecution {
  id: string;
  stage: string;
  status: string;
  statusMessage?: string | null;
  attempt: number;
  output: unknown;
}

export interface WorkflowRun {
  id: string;
  status: string;
  requirement: Requirement;
  workflowRepositories: Array<{
    id: string;
    name: string;
    url: string;
    baseBranch: string;
    workingBranch: string;
    localPath?: string | null;
    status: string;
    syncError?: string | null;
    preparedAt?: string | null;
  }>;
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
    diffArtifacts?: Array<{
      repository: string;
      branch: string;
      localPath: string;
      diffStat: string;
      diffText: string;
      untrackedFiles: string[];
    }>;
    status: string;
  };
  reviewReport?: {
    id: string;
    issues: string[];
    bugs: string[];
    missingTests: string[];
    suggestions: string[];
    impactScope: string[];
    status: string;
  };
  reviewFindings: ReviewFinding[];
  stageExecutions: StageExecution[];
}

export interface ReviewFinding {
  id: string;
  status: string;
  type: string;
  sourceType: string;
  sourceIndex: number;
  severity: string;
  title: string;
  description: string;
  recommendation?: string | null;
  impactScope?: string[] | null;
  convertedIssueId?: string | null;
  convertedBugId?: string | null;
}

export interface Issue {
  id: string;
  status: string;
  priority: string;
  title: string;
  description: string;
  workspace?: { id: string; name: string } | null;
  requirement?: { id: string; title: string } | null;
  workflowRun?: { id: string; status: string } | null;
  workflowRunId?: string | null;
  requirementId?: string | null;
  branchName?: string | null;
  createdAt?: string;
  resolution?: string | null;
  reviewFinding?: {
    id: string;
    type: string;
    severity: string;
    title: string;
    description: string;
  } | null;
}

export interface Bug {
  id: string;
  status: string;
  severity: string;
  priority: string;
  title: string;
  description: string;
  workspace?: { id: string; name: string } | null;
  requirement?: { id: string; title: string } | null;
  workflowRun?: { id: string; status: string } | null;
  workflowRunId?: string | null;
  requirementId?: string | null;
  branchName?: string | null;
  createdAt?: string;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  reproductionSteps?: string[] | null;
  resolution?: string | null;
  reviewFinding?: {
    id: string;
    type: string;
    severity: string;
    title: string;
    description: string;
  } | null;
}

export interface AuthOrganization {
  id: string;
  name: string;
  providerOrganizationId?: string;
  logoUrl?: string;
}

export interface AuthUser {
  id: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthUser;
  organization: AuthOrganization | null;
}
