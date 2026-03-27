export interface Requirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  workspace?: Workspace | null;
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
    issues: string[];
    bugs: string[];
    missingTests: string[];
    suggestions: string[];
    impactScope: string[];
    status: string;
  };
  stageExecutions: StageExecution[];
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
